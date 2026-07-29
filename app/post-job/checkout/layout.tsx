import Link from 'next/link';
import FeaturedTestimonials from '@/components/FeaturedTestimonials';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { ShieldCheck, Clock, LifeBuoy } from 'lucide-react';

/**
 * Checkout trust rail (content audit P2 #16 — employer trust at point of
 * sale).
 *
 * WHY A LAYOUT, NOT AN EDIT TO page.tsx: the checkout page is a client
 * component (it reads the draft out of localStorage and calls the Stripe
 * session API). The two things this rail adds — the real refund/support
 * policy and admin-approved testimonials — are server-side data. A nested
 * layout lets the server render them underneath the client page without
 * turning the whole route into a data-fetching client component or adding
 * a new API endpoint just to hydrate social proof.
 *
 * TRUTH RULES:
 *   - The policy text below MATCHES app/terms/page.tsx §8 exactly in
 *     substance: posting fees are GENERALLY NON-REFUNDABLE, and a refund
 *     request inside 7 days is CONSIDERED case by case. It is deliberately
 *     not phrased as a "7-day money-back guarantee", because that is not
 *     what the Terms say and a buyer discovering the difference after
 *     paying is exactly how chargebacks start.
 *   - Social proof comes from <FeaturedTestimonials>, which renders only
 *     consented, admin-approved rows and renders NOTHING when none exist.
 *     There is no fallback copy, no logo wall, and no invented quote.
 *   - Every number renders from lib/config.ts, the same source the price
 *     and the Stripe line item use.
 */

/**
 * Muted label colour for this rail. It sits on the bare page background —
 * app/post-job/checkout/page.tsx renders no wrapper background, so the aside
 * inherits body { background-color: #F5F0EB } from app/globals.css. The
 * site's usual #6B7280 measures 4.269:1 there, under the 4.5:1 AA minimum for
 * normal-size text, and a 13px uppercase heading does not qualify as large
 * text (that needs >=18.66px bold). #5A6E7A measures 4.700:1 on #F5F0EB and
 * 5.322:1 on #FFFFFF — the same token the trust pages moved to. Ratios are
 * sRGB relative luminance per WCAG 2.x; recompute before changing this.
 */
const MUTED_TEXT = '#5A6E7A';

const panel: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '16px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '4px 4px 12px rgba(0,0,0,0.05), -2px -2px 8px rgba(255,255,255,0.8)',
    padding: '20px 22px',
};

const assurances: { icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
    {
        icon: <Clock size={16} aria-hidden="true" />,
        title: 'What you are buying',
        body: (
            <>
                One {brand.niche.short} job posting, live for {config.durationDays} days, with the full feature set —
                Featured badge, top placement, {config.limits.candidateUnlocksPerPosting} candidate unlocks,{' '}
                {config.limits.inmailsPerPosting} InMails, and applicant analytics. A one-time charge of $
                {config.postingPrice}. No subscription is created and no card is stored by us.
            </>
        ),
    },
    {
        icon: <LifeBuoy size={16} aria-hidden="true" />,
        title: 'If it does not work out',
        body: (
            <>
                Posting fees are generally non-refundable, but if you are unsatisfied, email{' '}
                <a href={`mailto:${brand.email.support}`} style={{ color: '#BE185D', textDecoration: 'underline' }}>
                    {brand.email.support}
                </a>{' '}
                within <strong>7 days of purchase</strong> and we will review your refund request case by case.
                Postings removed for a Terms violation are not refunded. The full policy is in{' '}
                <Link href="/terms" style={{ color: '#BE185D', textDecoration: 'underline' }}>
                    Terms §8
                </Link>
                .
            </>
        ),
    },
    {
        icon: <ShieldCheck size={16} aria-hidden="true" />,
        title: 'You can still change it',
        body: (
            <>
                Salary, requirements, and description stay editable from your employer dashboard after the post goes
                live — changes publish immediately, and you do not pay again to edit.
            </>
        ),
    },
];

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            {children}
            <aside
                aria-labelledby="checkout-trust-heading"
                className="max-w-2xl mx-auto px-4 pb-12"
                style={{ marginTop: '8px' }}
            >
                <h2
                    id="checkout-trust-heading"
                    style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: MUTED_TEXT,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        margin: '0 0 12px',
                    }}
                >
                    Before you pay
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {assurances.map((a) => (
                        <div key={a.title} style={{ ...panel, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <span
                                style={{
                                    width: 30,
                                    height: 30,
                                    flexShrink: 0,
                                    borderRadius: 9,
                                    background: '#FDF2F8',
                                    color: '#BE185D',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {a.icon}
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: '13.5px', fontWeight: 700, color: '#1A2E35', margin: '0 0 3px' }}>
                                    {a.title}
                                </p>
                                <p style={{ fontSize: '13px', color: '#4A5568', margin: 0, lineHeight: 1.65 }}>
                                    {a.body}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Renders nothing until a consented testimonial has been
                    approved in /admin/testimonials. */}
                <FeaturedTestimonials variant="compact" />
            </aside>
        </>
    );
}

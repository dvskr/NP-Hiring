import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Star, ArrowRight } from 'lucide-react';

/**
 * FeaturedTestimonials — public display half of the employer-testimonial
 * read path (backlog B8; extended by content audit P2 #16/#18).
 *
 * Server component: queries admin-approved testimonials directly and
 * renders a social-proof section. Renders nothing at all when no
 * testimonial has been approved — no fabricated content, no empty-state
 * placeholder on a marketing page, and never a seeded example.
 *
 * Consent semantics (must match the write path in
 * app/api/employer/testimonials/route.ts and the admin review route):
 *   - only rows with consent === true AND an admin-set featuredAt appear;
 *   - displayAs controls attribution: 'full' shows the recorded name,
 *     'initial' shows first name + last initial, 'anonymous' shows a
 *     generic label;
 *   - the write path can fall back to the account email for employerName,
 *     so anything containing '@' is never rendered, whatever displayAs says.
 *
 * Two variants, one query:
 *   - 'section' (default) — the full band used on /for-employers. Links to
 *     /testimonials when more approved testimonials exist than fit here.
 *   - 'compact' — a narrow point-of-sale panel used on the checkout step.
 * Both read the same rows, so social proof shown at checkout can never be
 * a different (or looser) set than the one shown on the marketing page.
 */

const MAX_FEATURED = 6;
/** Point-of-sale panel stays short so it can't push the Pay button down. */
const MAX_COMPACT = 2;

export type FeaturedTestimonialsVariant = 'section' | 'compact';

interface FeaturedTestimonialsProps {
    variant?: FeaturedTestimonialsVariant;
}

interface FeaturedTestimonial {
    id: string;
    employerName: string;
    content: string;
    rating: number | null;
    displayAs: string;
}

export function formatAttribution(employerName: string, displayAs: string): string {
    const name = employerName.trim();
    // Never render an email address publicly, whatever the display preference.
    if (!name || name.includes('@')) return 'Verified employer';
    if (displayAs === 'anonymous') return 'Verified employer';
    if (displayAs === 'full') return name;
    // 'initial' (default): first name + last-word initial ("Jane D.").
    const words = name.split(/\s+/);
    if (words.length === 1) return words[0];
    return `${words[0]} ${words[1][0].toUpperCase()}.`;
}

/**
 * Muted label/footnote colour. The 'compact' variant renders inside the
 * checkout trust rail, which paints no background of its own and therefore
 * inherits body { background-color: #F5F0EB } from app/globals.css. The
 * site's usual #6B7280 measures 4.269:1 there — under the 4.5:1 AA minimum
 * for normal-size text, and neither the 13px uppercase heading nor the
 * 11.5px footnote qualifies as large text. #5A6E7A measures 4.700:1 on
 * #F5F0EB and 5.322:1 on #FFFFFF, matching the token the trust pages use.
 * Ratios are sRGB relative luminance per WCAG 2.x; recompute before changing.
 */
const MUTED_TEXT = '#5A6E7A';

/* Clay card treatment matched to the /for-employers bento sections. */
const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Star row. Extracted so both variants render ratings identically. */
export function RatingStars({ rating, size = 15 }: { rating: number; size?: number }) {
    return (
        <div role="img" aria-label={`Rated ${rating} out of 5 stars`} style={{ display: 'flex', gap: '3px' }}>
            {[1, 2, 3, 4, 5].map((i) => (
                <Star
                    key={i}
                    size={size}
                    aria-hidden="true"
                    fill={i <= rating ? '#F59E0B' : 'none'}
                    style={{ color: i <= rating ? '#F59E0B' : '#D1D5DB' }}
                />
            ))}
        </div>
    );
}

export default async function FeaturedTestimonials({ variant = 'section' }: FeaturedTestimonialsProps = {}) {
    let testimonials: FeaturedTestimonial[];
    let approvedTotal = 0;
    try {
        testimonials = await prisma.employerTestimonial.findMany({
            where: { consent: true, featuredAt: { not: null } },
            orderBy: { featuredAt: 'desc' },
            take: MAX_FEATURED,
            select: {
                id: true,
                employerName: true,
                content: true,
                rating: true,
                displayAs: true,
            },
        });
        // Drives the "read them all" link only. Counted with the same consent
        // gate as the rows themselves so the link can never promise more than
        // /testimonials will actually render.
        approvedTotal = await prisma.employerTestimonial.count({
            where: { consent: true, featuredAt: { not: null } },
        });
    } catch (error) {
        // A marketing page must never 500 over its social-proof section.
        logger.error('[FeaturedTestimonials] failed to load featured testimonials', error);
        return null;
    }

    if (testimonials.length === 0) return null;

    if (variant === 'compact') {
        const shown = testimonials.slice(0, MAX_COMPACT);
        return (
            <section aria-labelledby="checkout-testimonials-heading" style={{ marginTop: '24px' }}>
                <h2
                    id="checkout-testimonials-heading"
                    style={{ fontSize: '13px', fontWeight: 700, color: MUTED_TEXT, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}
                >
                    From hiring teams who posted here
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {shown.map((t) => (
                        <figure key={t.id} style={{ ...clayCard, margin: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {t.rating !== null && <RatingStars rating={t.rating} size={13} />}
                            <blockquote style={{ margin: 0, fontSize: '13.5px', color: '#4A3A40', lineHeight: 1.6 }}>
                                &ldquo;{t.content}&rdquo;
                            </blockquote>
                            <figcaption style={{ fontSize: '12px', fontWeight: 700, color: '#7A1C2B' }}>
                                — {formatAttribution(t.employerName, t.displayAs)}
                            </figcaption>
                        </figure>
                    ))}
                </div>
                <p style={{ fontSize: '11.5px', color: MUTED_TEXT, margin: '10px 0 0', lineHeight: 1.5 }}>
                    Posted by real employers on this board and published with their permission.{' '}
                    {approvedTotal > shown.length && (
                        <Link href="/testimonials" style={{ color: '#BE185D', textDecoration: 'underline' }}>
                            Read all {approvedTotal}
                        </Link>
                    )}
                </p>
            </section>
        );
    }

    return (
        <section aria-labelledby="employer-testimonials-heading" style={{ background: '#FDFBF7', padding: '72px 20px' }}>
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                    From Hiring Teams
                </p>
                <h2 id="employer-testimonials-heading" className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
                    What Employers Say
                </h2>
                <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '460px', margin: '0 auto 44px', lineHeight: 1.6 }}>
                    Real feedback from teams that hired here — shared with their permission.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
                    {testimonials.map((t) => (
                        <figure key={t.id} style={{ ...clayCard, margin: 0, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {t.rating !== null && <RatingStars rating={t.rating} />}
                            <blockquote style={{ margin: 0, fontSize: '14.5px', color: '#4A3A40', lineHeight: 1.7 }}>
                                &ldquo;{t.content}&rdquo;
                            </blockquote>
                            <figcaption style={{ marginTop: 'auto', fontSize: '13px', fontWeight: 700, color: '#7A1C2B' }}>
                                — {formatAttribution(t.employerName, t.displayAs)}
                            </figcaption>
                        </figure>
                    ))}
                </div>

                {approvedTotal > testimonials.length && (
                    <p style={{ textAlign: 'center', marginTop: '28px' }}>
                        <Link
                            href="/testimonials"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#BE185D', textDecoration: 'underline' }}
                        >
                            Read all {approvedTotal} employer testimonials <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                    </p>
                )}
            </div>
        </section>
    );
}

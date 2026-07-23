import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Star } from 'lucide-react';

/**
 * FeaturedTestimonials — public display half of the employer-testimonial
 * read path (backlog B8).
 *
 * Server component: queries admin-approved testimonials directly and
 * renders a social-proof section on /for-employers. Renders nothing at
 * all when no testimonial has been approved — no fabricated content,
 * no empty-state placeholder on a marketing page.
 *
 * Consent semantics (must match the write path in
 * app/api/employer/testimonials/route.ts and the admin review route):
 *   - only rows with consent === true AND an admin-set featuredAt appear;
 *   - displayAs controls attribution: 'full' shows the recorded name,
 *     'initial' shows first name + last initial, 'anonymous' shows a
 *     generic label;
 *   - the write path can fall back to the account email for employerName,
 *     so anything containing '@' is never rendered, whatever displayAs says.
 */

const MAX_FEATURED = 6;

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

/* Clay card treatment matched to the /for-employers bento sections. */
const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export default async function FeaturedTestimonials() {
    let testimonials: FeaturedTestimonial[];
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
    } catch (error) {
        // A marketing page must never 500 over its social-proof section.
        logger.error('[FeaturedTestimonials] failed to load featured testimonials', error);
        return null;
    }

    if (testimonials.length === 0) return null;

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
                            {t.rating !== null && (
                                <div role="img" aria-label={`Rated ${t.rating} out of 5 stars`} style={{ display: 'flex', gap: '3px' }}>
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <Star
                                            key={i}
                                            size={15}
                                            aria-hidden="true"
                                            fill={i <= (t.rating as number) ? '#F59E0B' : 'none'}
                                            style={{ color: i <= (t.rating as number) ? '#F59E0B' : '#D1D5DB' }}
                                        />
                                    ))}
                                </div>
                            )}
                            <blockquote style={{ margin: 0, fontSize: '14.5px', color: '#4A3A40', lineHeight: 1.7 }}>
                                &ldquo;{t.content}&rdquo;
                            </blockquote>
                            <figcaption style={{ marginTop: 'auto', fontSize: '13px', fontWeight: 700, color: '#7A1C2B' }}>
                                — {formatAttribution(t.employerName, t.displayAs)}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>
        </section>
    );
}

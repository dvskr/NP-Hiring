/**
 * /testimonials — public display surface for the consent-gated employer
 * testimonial system (content audit P2 #18).
 *
 * TRUTH RULES this page is built around:
 *   - It renders ONLY rows that a real, authenticated employer submitted
 *     through app/api/employer/testimonials/route.ts with explicit
 *     consent === true, and that an admin then featured (featuredAt set).
 *     There is no seed data, no example content, and no placeholder card.
 *   - When nothing has been approved the route 404s rather than publishing
 *     a thin "no testimonials yet" page. An empty social-proof page is
 *     worse than no page: it is a soft-404 for search engines and an
 *     invitation for someone to "just add a couple of examples".
 *   - Attribution goes through the SAME formatAttribution() the featured
 *     band uses, so the display level can never be looser here than the
 *     employer consented to, and an account email can never leak.
 *   - Deliberately NO Review / AggregateRating JSON-LD. Google treats
 *     self-hosted reviews of your own organisation as self-serving and
 *     ineligible for review rich results; emitting it would be a
 *     structured-data violation, not an SEO win.
 */
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { formatAttribution, RatingStars } from '@/components/FeaturedTestimonials';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { ShieldCheck, ArrowRight, MessageSquareQuote } from 'lucide-react';

export const revalidate = 3600;

/** Hard cap so a long-running board can't render an unbounded page. */
const MAX_TESTIMONIALS = 60;

export const metadata: Metadata = {
    title: 'Employer Testimonials',
    description: `What hiring teams say about posting ${brand.niche.long} roles on ${brand.name} — published only with the employer's explicit permission.`,
    alternates: { canonical: `${brand.baseUrl}/testimonials` },
    robots: { index: true, follow: true },
};

interface PublicTestimonial {
    id: string;
    employerName: string;
    content: string;
    rating: number | null;
    displayAs: string;
    featuredAt: Date | null;
}

/**
 * Consent-gated read. Returns an empty array on DB failure so the route
 * 404s instead of 500ing — the same degrade-to-nothing posture the
 * featured band takes.
 */
async function getApprovedTestimonials(): Promise<PublicTestimonial[]> {
    try {
        return await prisma.employerTestimonial.findMany({
            where: { consent: true, featuredAt: { not: null } },
            orderBy: { featuredAt: 'desc' },
            take: MAX_TESTIMONIALS,
            select: {
                id: true,
                employerName: true,
                content: true,
                rating: true,
                displayAs: true,
                featuredAt: true,
            },
        });
    } catch (error) {
        logger.error('[testimonials] failed to load approved testimonials', error);
        return [];
    }
}

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };

/**
 * Muted/meta text. The site's usual muted grey, #6B7F8A, measures 4.177:1 on
 * #FFFFFF and 3.689:1 on the #F5F0EB page background — under the 4.5:1 AA
 * minimum for normal-size text, and named as a known contrast gap on
 * /accessibility. This darker slate clears it on both surfaces (5.322:1 and
 * 4.700:1) while staying subordinate to the #4A5568 body copy. Ratios are
 * sRGB relative luminance per WCAG 2.x; recompute before changing this value.
 */
const MUTED_TEXT = '#5A6E7A';

export default async function TestimonialsPage() {
    const testimonials = await getApprovedTestimonials();

    // Nothing approved (or the read failed) → no page. Never a placeholder.
    if (testimonials.length === 0) notFound();

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'For Employers', url: `${brand.baseUrl}/for-employers` },
                    { name: 'Testimonials', url: `${brand.baseUrl}/testimonials` },
                ]}
            />

            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                <header style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 14px',
                            background: '#FDF2F8',
                            color: '#BE185D',
                            borderRadius: '20px',
                            fontSize: '13px',
                            fontWeight: 700,
                            marginBottom: '16px',
                        }}
                    >
                        <MessageSquareQuote size={14} /> Trust Center
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(2rem, 5vw, 2.75rem)',
                            fontWeight: 800,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35',
                            margin: '0 0 12px 0',
                            lineHeight: 1.15,
                        }}
                    >
                        What Hiring Teams <span style={{ color: '#BE185D' }}>Say</span>
                    </h1>
                    <p
                        style={{
                            fontSize: '15px',
                            color: '#4A5568',
                            margin: '0 auto',
                            maxWidth: '620px',
                            lineHeight: 1.7,
                        }}
                    >
                        Every testimonial below was written by an employer with a real posting account on{' '}
                        {brand.name} and is published only because that employer explicitly opted in. We do not
                        solicit, script, edit, or incentivise them — and we do not invent them.
                    </p>
                </header>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                        gap: '18px',
                    }}
                >
                    {testimonials.map((t) => (
                        <figure
                            key={t.id}
                            style={{
                                ...clayCard,
                                margin: 0,
                                padding: '26px 24px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '14px',
                            }}
                        >
                            {t.rating !== null && <RatingStars rating={t.rating} />}
                            <blockquote style={{ margin: 0, fontSize: '14.5px', color: '#4A3A40', lineHeight: 1.7 }}>
                                &ldquo;{t.content}&rdquo;
                            </blockquote>
                            <figcaption
                                style={{
                                    marginTop: 'auto',
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    gap: '10px',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span style={{ fontSize: '13px', fontWeight: 700, color: '#7A1C2B' }}>
                                    — {formatAttribution(t.employerName, t.displayAs)}
                                </span>
                                {t.featuredAt && (
                                    <time
                                        dateTime={t.featuredAt.toISOString()}
                                        style={{ fontSize: '12px', color: MUTED_TEXT }}
                                    >
                                        {t.featuredAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                    </time>
                                )}
                            </figcaption>
                        </figure>
                    ))}
                </div>

                {/* How this works — the credibility of the page above depends
                    entirely on this being spelled out. */}
                <section
                    aria-labelledby="testimonial-policy-heading"
                    style={{ ...clayCard, padding: '28px 30px', marginTop: '36px' }}
                >
                    <h2
                        id="testimonial-policy-heading"
                        style={{
                            fontSize: '18px',
                            fontWeight: 700,
                            color: '#1A2E35',
                            margin: '0 0 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <ShieldCheck size={18} style={{ color: '#BE185D' }} aria-hidden="true" /> How these are
                        collected
                    </h2>
                    <ul
                        style={{
                            margin: 0,
                            paddingLeft: '20px',
                            fontSize: '14px',
                            color: '#4A5568',
                            lineHeight: 1.85,
                        }}
                    >
                        <li>
                            <strong>Only real, signed-in employers can submit one.</strong> The form lives in the
                            employer dashboard and the submission is tied to that account and its postings.
                        </li>
                        <li>
                            <strong>Consent is a hard requirement.</strong> A submission without an explicit
                            public-display opt-in is rejected outright rather than stored for later.
                        </li>
                        <li>
                            <strong>You choose how you are named.</strong> Full name, first name with a last initial,
                            or &quot;verified employer&quot;. That choice can be narrowed afterwards but never
                            widened, and an account email is never shown as attribution.
                        </li>
                        <li>
                            <strong>Wording is theirs.</strong> We publish the text as submitted. We do not rewrite
                            it, and nothing is offered in exchange for a positive one.
                        </li>
                        <li>
                            <strong>Removal on request.</strong> Email{' '}
                            <a href={`mailto:${brand.email.support}`} style={linkStyle}>
                                {brand.email.support}
                            </a>{' '}
                            and we will unpublish yours.
                        </li>
                    </ul>
                    <p style={{ fontSize: '13.5px', color: MUTED_TEXT, margin: '14px 0 0', lineHeight: 1.7 }}>
                        Our wider rules on what we will and will not publish — including our standing ban on
                        fabricated people, quotes, and reviews — are in the{' '}
                        <Link href="/editorial-policy" style={linkStyle}>
                            editorial policy
                        </Link>
                        .
                    </p>
                </section>

                <div style={{ textAlign: 'center', marginTop: '32px' }}>
                    <Link
                        href="/post-job"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '13px 26px',
                            borderRadius: '12px',
                            fontWeight: 700,
                            fontSize: '14px',
                            background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                            color: '#fff',
                            textDecoration: 'none',
                            boxShadow: '4px 4px 12px rgba(190,24,93,0.2)',
                        }}
                    >
                        Post a job — first post free <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                    <p style={{ fontSize: '12.5px', color: MUTED_TEXT, margin: '10px 0 0' }}>
                        Free posts run {config.freeDurationDays} days. See{' '}
                        <Link href="/for-employers" style={linkStyle}>
                            what every post includes
                        </Link>
                        .
                    </p>
                </div>
            </div>
        </div>
    );
}

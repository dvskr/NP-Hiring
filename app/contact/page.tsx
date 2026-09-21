import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Clock, HelpCircle, ArrowRight } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { brand } from '@/config/brand';
import ContactForm from './ContactForm';
import ContactFAQ from './ContactFAQ';

// Single source of truth for FAQ content. Both the FAQPage JSON-LD and the
// visible accordion consume this list — they cannot diverge. Since B4 the
// accordion is a SERVER component (app/contact/ContactFAQ.tsx), so every
// answer below is in the served HTML that backs the schema; before that the
// schema named questions whose answers only existed after a click.
//
// CLAIM RULES for anything added here. Each answer states only what the repo
// can back, and names no cadence, price or turnaround that a config change
// could silently falsify:
//   - ingest cadence: config/cron-schedule.ts schedules ingestion waves every
//     day, so the answer says "every day" and agrees with the "ingested daily"
//     wording on the salary surfaces. The old answer said "twice daily", which
//     reads as a contradiction of that wording and pins a wave count a cron
//     edit can silently falsify. No source count either: the source list is a
//     per-board decision in the same config.
//   - employer posting: what a posting includes and costs lives on /pricing
//     (lib/config.ts). The old answer sold "Featured listings ... for enhanced
//     visibility" as an upsell; there is no separate featured product
//     (config.isFeaturedTier is unconditional), so it linked to a thing that
//     does not exist.
//   - alerts: lib/job-alerts-service.ts sends a daily OR weekly digest and the
//     form at /job-alerts offers both, so the answer cannot promise "daily".
//   - deletion: app/api/auth/delete-account/route.ts closes the account on the
//     spot and purges after PURGE_GRACE_DAYS. The answer says "a grace window"
//     rather than the number, because that constant is private to the route
//     and copy may not restate a figure it cannot import. The old "within 24
//     hours" was a turnaround nothing in the repo enforces.
//   - disappearing listings: expiry, the repeated-dead-link gate
//     (lib/active-job-filter.ts) and the distinct-reporter auto-unpublish in
//     app/api/jobs/report/route.ts are each real code paths.
const FAQ_ITEMS = [
    { q: `Is ${brand.name} free for job seekers?`, a: 'Yes. Browsing jobs, setting up alerts, and applying are completely free. We never charge job seekers.' },
    // P0 #5 still applies here: no hardcoded company or posting count
    // (config/niche/copy.ts RULE: evergreen claims only; live counters come
    // from lib/site-stats.ts).
    { q: 'How often are jobs updated?', a: 'Our ingest runs on a schedule every day, pulling new listings from employer career pages and from the applicant tracking systems those employers publish through. Every listing carries the date it was posted, so you can see for yourself how fresh one is.' },
    { q: 'How do I post a job as an employer?', a: 'Create an employer account, then post from the Post a Job page. Our pricing page lists what a posting costs and everything it includes, and you can renew or archive it later from the employer dashboard.' },
    { q: 'Can I get job alerts by email?', a: 'Yes. Sign up for free, set your filters for location, job type and salary range, then choose a daily or a weekly digest. We email the matching jobs on whichever schedule you pick, and every message can unsubscribe you.' },
    { q: 'How do I delete my account?', a: `Go to Settings, open Account and choose Delete Account. Your account closes immediately, and your records are erased after a grace window that exists so a deletion made by mistake can still be reversed. You can also email ${brand.email.support} and we will do it for you.` },
    { q: 'Why did a job listing disappear?', a: 'A listing comes down when it expires, when the employer\'s own apply link has been dead on several consecutive checks, or when enough separate readers report it as invalid. Check the employer\'s site for its latest openings.' },
];

export const metadata: Metadata = {
    // `absolute` opts out of the layout title template so we don't
    // double-suffix " | PMHNP Hiring".
    title: { absolute: `Contact ${brand.name}: Support, Employer, and Partnership Inquiries` },
    description: `Reach the ${brand.name} team for job-seeker support, employer questions, partnerships, or feedback. We respond within 24 to 48 hours.`,
    alternates: { canonical: `${brand.baseUrl}/contact` },
    openGraph: {
        title: `Contact ${brand.name}`,
        // C.5 claim sweep: the previous copy called this "the #1 NP job board",
        // a ranking claim with no source behind it.
        description: `Get in touch with the ${brand.name} team for support, employer, and partnership inquiries.`,
        type: 'website',
        url: `${brand.baseUrl}/contact`,
        siteName: brand.name,
    },
    twitter: { card: 'summary_large_image', title: `Contact ${brand.name}`, description: 'Get in touch with the team for support, employer, and partnership inquiries.' },
};

const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const clayIconWrap = (gradient: string): React.CSSProperties => ({
    width: '40px', height: '40px', borderRadius: '12px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: gradient,
    boxShadow: '3px 3px 8px rgba(0,0,0,0.06), inset 1px 1px 2px rgba(255,255,255,0.2)',
    flexShrink: 0,
});

export default function ContactPage() {
    const contactPageSchema = {
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        '@id': `${brand.baseUrl}/contact#contactpage`,
        url: `${brand.baseUrl}/contact`,
        name: `Contact ${brand.name}`,
        description: `Reach the ${brand.name} team for support, employer, and partnership inquiries.`,
        mainEntity: {
            '@type': 'Organization',
            name: brand.name,
            url: brand.baseUrl,
            contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'customer support',
                email: brand.email.support,
                availableLanguage: 'English',
                areaServed: 'US',
            },
        },
    };

    const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
    };

    return (
        <div style={{ background: '#F5F6F8', minHeight: '100vh' }}>
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Contact', url: `${brand.baseUrl}/contact` },
            ]} />

            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(contactPageSchema) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />

            {/* Hero */}
            <section style={{ padding: '80px 16px 64px', maxWidth: '1000px', margin: '0 auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '32px', alignItems: 'center' }} className="contact-hero-grid">
                    <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: '#E6F4F1', color: '#BE185D', borderRadius: '20px', fontSize: '13px', fontWeight: 700, marginBottom: '24px' }}>
                            <Mail size={14} /> Contact Us
                        </div>
                        <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', fontWeight: 800, fontFamily: 'var(--font-lora), Georgia, serif', color: '#1A2E35', marginBottom: '16px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                            We&apos;d love to <span style={{ color: '#BE185D' }}>hear from you</span>
                        </h1>
                        <p style={{ fontSize: '20px', color: '#6B7F8A', lineHeight: 1.6, margin: 0, maxWidth: '500px' }}>
                            Whether you represent a clinic seeking your next top-tier {brand.niche.short} or you are a candidate looking for the perfect match, our team is ready to help.
                        </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Image src="/images/contact/hero.webp" alt={`Contact ${brand.niche.short} Jobs`} width={280} height={280} style={{ objectFit: 'contain', filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.15))' }} priority />
                    </div>
                </div>
            </section>

            {/* FAQ Section */}
            <section style={{ maxWidth: '700px', margin: '0 auto', padding: '0 16px 40px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-lora), Georgia, serif', color: '#1A2E35', textAlign: 'center', marginBottom: '20px' }}>
                    Quick Answers
                </h2>
                <ContactFAQ items={FAQ_ITEMS} />
            </section>

            {/* Main Content — Two Column */}
            <section style={{ maxWidth: '960px', margin: '0 auto', padding: '0 16px 80px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', alignItems: 'start' }}>

                    {/* Left: Form (interactive — extracted as a client child) */}
                    <ContactForm />

                    {/* Right: Info (static — server-rendered) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ ...clayCard, padding: '24px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', marginBottom: '18px' }}>Contact Info</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ ...clayIconWrap('linear-gradient(145deg, #BE185D, #9D174D)'), width: '36px', height: '36px', borderRadius: '10px' }}>
                                        <Mail size={16} color="#fff" />
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#1A2E35', margin: '0 0 2px' }}>Email</p>
                                        <a href={`mailto:${brand.email.support}`} style={{ fontSize: '13px', color: '#BE185D', textDecoration: 'none' }}>{brand.email.support}</a>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ ...clayIconWrap('linear-gradient(145deg, #3B82F6, #60A5FA)'), width: '36px', height: '36px', borderRadius: '10px' }}>
                                        <Clock size={16} color="#fff" />
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#1A2E35', margin: '0 0 2px' }}>Response Time</p>
                                        <p style={{ fontSize: '13px', color: '#8A9BA6', margin: 0 }}>We respond within 24 to 48 hours</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ ...clayIconWrap('linear-gradient(145deg, #8B5CF6, #A855F7)'), width: '36px', height: '36px', borderRadius: '10px' }}>
                                        <HelpCircle size={16} color="#fff" />
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#1A2E35', margin: '0 0 2px' }}>Quick Answers</p>
                                        <Link href="/faq" style={{ fontSize: '13px', color: '#BE185D', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Visit FAQ <ArrowRight size={12} /></Link>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ ...clayCard, padding: '24px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', marginBottom: '14px' }}>Quick Links</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[
                                    { label: 'FAQ', href: '/faq' },
                                    // The two answers above name the posting flow and its
                                    // price; an accordion answer is plain text, so the
                                    // links a reader needs live here.
                                    { label: 'Post a Job', href: '/post-job' },
                                    { label: 'Pricing', href: '/pricing' },
                                    { label: `About ${brand.niche.short} Jobs`, href: '/about' },
                                    { label: 'Terms of Service', href: '/terms' },
                                    { label: 'Privacy Policy', href: '/privacy' },
                                ].map(link => (
                                    <Link key={link.href} href={link.href} style={{
                                        fontSize: '13px', color: '#BE185D', textDecoration: 'none',
                                        padding: '8px 12px', borderRadius: '10px', background: '#F5F6F8',
                                        boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.03)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    }}>
                                        {link.label} <ArrowRight size={12} />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <style>{`
                @media (max-width: 768px) {
                    section > div[style*="grid-template-columns: 2fr 1fr"] {
                        grid-template-columns: 1fr !important;
                    }
                    .contact-hero-grid { grid-template-columns: 1fr !important; text-align: center; }
                    .contact-hero-grid > div:last-child { order: -1; }
                    .contact-hero-grid > div:first-child p { margin-left: auto; margin-right: auto; }
                }
            `}</style>
        </div>
    );
}

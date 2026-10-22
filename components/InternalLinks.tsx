import Link from 'next/link';
import { MapPin, Briefcase, Wifi, Video, Calendar } from 'lucide-react';
import { brand } from '@/config/brand';
import { jobTypeValueCategory, type JobTypeCategory } from '@/lib/pseo/category-structural';

interface InternalLinksProps {
    state?: string | null;
    /** Accepted for callers; the links key on the state name. */
    stateCode?: string | null;
    /** Accepted for callers; no city link is offered here. */
    city?: string | null;
    /**
     * True only for a job verified as fully remote (isVerifiedFullyRemote in
     * app/jobs/[slug]/job-posting-facts.ts), never the stored isRemote flag.
     * It alone decides the "More Remote ... Jobs" link.
     */
    isRemote?: boolean;
    isTelehealth?: boolean;
    /** The page's resolved primary employment type, never the raw column. */
    jobType?: string | null;
    /** True when the job carries the travel tag, so /jobs/travel lists it. */
    isTravel?: boolean;
    /** The verified work mode label (resolveWorkModeLabel), never the raw column. */
    mode?: string | null;
}

/**
 * The landing for each job type that has a link here, chosen by the rule the
 * landings list by (jobTypeValueCategory). Register 2.26: a Contract job was
 * sent to /jobs/travel, which lists only jobs tagged travel, and a Locum
 * Tenens job had no link.
 * Test: tests/regressions/internal-links-job-type-landings.test.ts
 */
const JOB_TYPE_LANDINGS: Partial<Record<JobTypeCategory, { href: string; label: string; Icon: typeof Calendar }>> = {
    'per-diem': { href: '/jobs/per-diem', label: `View Per Diem ${brand.niche.short} Jobs`, Icon: Calendar },
    contract: { href: '/jobs/contract', label: `View Contract ${brand.niche.short} Jobs`, Icon: Briefcase },
    'locum-tenens': { href: '/jobs/locum-tenens', label: `View Locum Tenens ${brand.niche.short} Jobs`, Icon: Briefcase },
};

/* ═══ Clay tokens ═══ */
const clayShadow = '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)';
const clayPebbleShadow = '4px 4px 10px rgba(0,0,0,0.06), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';

/**
 * Component to add internal SEO links to job detail pages
 * Links to state pages, city pages, and job type category pages
 */
export default function InternalLinks({
    state,
    isRemote,
    isTelehealth,
    jobType,
    isTravel,
    mode,
}: InternalLinksProps) {
    const links: { href: string; label: string; icon: React.ReactNode }[] = [];

    // State page link
    if (state) {
        const stateSlug = state.toLowerCase().replace(/\s+/g, '-');
        links.push({
            href: `/jobs/state/${stateSlug}`,
            label: `All ${brand.niche.short} Jobs in ${state}`,
            icon: <MapPin style={{ width: '14px', height: '14px' }} />,
        });
    }

    // Remote jobs link. Indexing audit GFJ-01: only a verified remote job
    // offers "More Remote ... Jobs". A mode string is not read here: stale
    // rows carry "Remote" on on-site jobs, and the link would contradict the
    // page's work-mode chip, title and JobPosting markup.
    if (isRemote) {
        links.push({
            href: '/jobs/remote',
            label: `More Remote ${brand.niche.short} Jobs`,
            icon: <Wifi style={{ width: '14px', height: '14px' }} />,
        });
    }

    // Telehealth jobs link
    if (isTelehealth || mode?.toLowerCase().includes('telehealth')) {
        links.push({
            href: '/jobs/telehealth',
            label: 'Browse Telehealth Positions',
            icon: <Video style={{ width: '14px', height: '14px' }} />,
        });
    }

    // Job type specific links
    const jobTypeCategory = jobTypeValueCategory(jobType);
    const typeLanding = jobTypeCategory ? JOB_TYPE_LANDINGS[jobTypeCategory] : undefined;
    if (typeLanding) {
        links.push({
            href: typeLanding.href,
            label: typeLanding.label,
            icon: <typeLanding.Icon style={{ width: '14px', height: '14px' }} />,
        });
    }

    if (isTravel) {
        links.push({
            href: '/jobs/travel',
            label: `Explore Travel ${brand.niche.short} Positions`,
            icon: <Briefcase style={{ width: '14px', height: '14px' }} />,
        });
    }

    if (links.length === 0) {
        links.push({
            href: '/jobs',
            label: `Browse All ${brand.niche.short} Jobs`,
            icon: <Briefcase style={{ width: '14px', height: '14px' }} />,
        });
    }

    const displayLinks = links.slice(0, 3);

    return (
        <section style={{
            backgroundColor: '#F7FBF8',
            borderRadius: '22px',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: clayShadow,
            overflow: 'hidden',
        }}>

            {/* Content */}
            <div style={{ padding: '18px 20px 20px' }}>
                <h3 style={{
                    fontSize: '14px', fontWeight: 700,
                    fontFamily: 'var(--font-lora), Georgia, serif',
                    color: '#1F2937', margin: '0 0 14px',
                }}>Explore More Opportunities</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {displayLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="il-btn"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '10px 14px',
                                borderRadius: '14px',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#BE185D',
                                backgroundColor: '#F0FAF8',
                                border: '1px solid rgba(255,255,255,0.5)',
                                textDecoration: 'none',
                                transition: 'all 0.2s ease',
                                boxShadow: clayPebbleShadow,
                            }}
                        >
                            <span style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                                backgroundColor: '#D5F5F1',
                                boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.04), 2px 2px 4px rgba(0,0,0,0.05)',
                                border: '1px solid rgba(255,255,255,0.6)',
                            }}>
                                {link.icon}
                            </span>
                            {link.label}
                        </Link>
                    ))}
                </div>
            </div>
            <style>{`
                .il-btn:hover {
                    transform: translateY(-2px) !important;
                    background-color: #FDF2F8 !important;
                    box-shadow: 6px 6px 14px rgba(190,24,93,0.12), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03) !important;
                }
                .il-btn:active {
                    transform: translateY(0) !important;
                    box-shadow: 1px 1px 3px rgba(0,0,0,0.04), inset 2px 2px 4px rgba(0,0,0,0.06) !important;
                }
            `}</style>
        </section>
    );
}

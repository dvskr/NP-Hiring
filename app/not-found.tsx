import Link from 'next/link';
import { Search, Home, Briefcase, ChevronRight, MapPin, Stethoscope, Compass } from 'lucide-react';
import { brand } from '@/config/brand';
import { CATEGORY_LABELS } from '@/lib/pseo/category-faq-data';

/**
 * 404 — the single highest-traffic error surface on the board.
 *
 * Every retired donor URL, every expired job, every mistyped pSEO slug and
 * every stale backlink lands here (middleware 410s a few donor slugs, the
 * rest fall through app/[...catchall]/page.tsx). P3 #13: it previously
 * offered two generic buttons and two marketing cards — no way to actually
 * find what the visitor came for. It now carries a real search entry point
 * plus the three navigational axes the site is organized around
 * (specialty · state · popular destinations).
 *
 * Deliberately DB-free: this page is hit by crawlers on dead URLs at
 * unbounded volume, so it must stay statically renderable. Every link below
 * is a permanent route; the category labels derive from the taxonomy's own
 * label map so a renamed slug can't leave a dead link here.
 */

/** Specialty + modality entry points — labels come from the taxonomy map. */
const CATEGORY_LINKS: ReadonlyArray<keyof typeof CATEGORY_LABELS> = [
    'remote',
    'telehealth',
    'family-practice',
    'acute-care',
    'primary-care',
    'pediatric',
    'anesthesia',
    'new-grad',
];

/**
 * State entry points. Names + slugs only — no counts, no "top"/"most"
 * ranking claim (that would be an uncited statistic), and no coverage
 * claim about the /jobs/locations index this list links on to: that page
 * renders `stats.states`, a Prisma groupBy over currently-published jobs
 * filtered through its own US whitelist, so it lists only states that hold
 * live inventory today — not a fixed 50/51. Labels here therefore name the
 * destination ("All locations"), never its size.
 */
const STATE_LINKS: ReadonlyArray<{ name: string; slug: string }> = [
    { name: 'California', slug: 'california' },
    { name: 'Texas', slug: 'texas' },
    { name: 'Florida', slug: 'florida' },
    { name: 'New York', slug: 'new-york' },
    { name: 'Pennsylvania', slug: 'pennsylvania' },
    { name: 'Illinois', slug: 'illinois' },
    { name: 'Ohio', slug: 'ohio' },
    { name: 'North Carolina', slug: 'north-carolina' },
    { name: 'Georgia', slug: 'georgia' },
    { name: 'Michigan', slug: 'michigan' },
    { name: 'Washington', slug: 'washington' },
    { name: 'Arizona', slug: 'arizona' },
];

const POPULAR_PAGES: ReadonlyArray<{ href: string; label: string; blurb: string }> = [
    { href: '/jobs', label: 'All jobs', blurb: 'Search and filter the full board' },
    { href: '/salary-guide', label: 'Salary guide', blurb: 'Pay by state and specialty' },
    { href: '/jobs/locations', label: 'Jobs by location', blurb: 'Browse states and cities' },
    { href: '/blog', label: 'Career guides', blurb: 'Licensure, interviews, negotiation' },
    { href: '/resources', label: 'Resources & tools', blurb: 'Guides, checkers, calculators' },
    { href: '/job-alerts', label: 'Job alerts', blurb: 'New matches by email' },
    { href: '/companies', label: 'Employers', blurb: 'Browse hiring organizations' },
    { href: '/post-job', label: 'Post a job', blurb: 'For employers and recruiters' },
];

/* ═══ Clay Tokens ═══ */
const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '24px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6)',
};
const sectionTitle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '15px', fontWeight: 700, color: '#0F172A', margin: '0 0 14px',
};
const pillStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '8px 14px', borderRadius: '999px',
    fontSize: '13px', fontWeight: 600, color: '#334155',
    background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.06)',
    textDecoration: 'none',
};

export default function NotFound() {
    return (
        <main style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '60px 20px',
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
        }}>
            <div style={{ maxWidth: '720px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* ── 404 hero + search ── */}
                <div style={{
                    ...clayCard,
                    background: 'linear-gradient(145deg, #FFFFFF, #F8FAFC)',
                    overflow: 'hidden',
                    padding: '44px 40px 36px',
                    textAlign: 'center' as const,
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #BE185D, #F472B6)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        fontSize: '96px',
                        fontWeight: 900,
                        lineHeight: '1',
                        marginBottom: '14px',
                        fontFamily: 'var(--font-lora), Georgia, serif',
                        letterSpacing: '-4px',
                    }}>
                        404
                    </div>

                    <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
                        We couldn&apos;t find that page
                    </h1>

                    <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, maxWidth: '440px', margin: '0 auto 24px' }}>
                        The link may be out of date, or the job it pointed to has been filled or
                        expired. Search the board or pick up one of the trails below.
                    </p>

                    {/* Plain GET form — works without JavaScript, submits to the
                        /jobs search param parsed by lib/filters.ts (`q`). */}
                    <form
                        action="/jobs"
                        method="get"
                        role="search"
                        style={{ maxWidth: '440px', margin: '0 auto', textAlign: 'left' }}
                    >
                        <label
                            htmlFor="notfound-search"
                            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}
                        >
                            Search {brand.niche.short} jobs
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <input
                                id="notfound-search"
                                type="search"
                                name="q"
                                placeholder="Job title, specialty, employer, or city"
                                autoComplete="off"
                                style={{
                                    flex: '1 1 220px', minWidth: 0,
                                    padding: '12px 16px', borderRadius: '14px',
                                    fontSize: '14px', color: '#0F172A',
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(0,0,0,0.12)',
                                    boxShadow: 'inset 2px 2px 5px rgba(0,0,0,0.03)',
                                }}
                            />
                            <button type="submit" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '12px 22px', borderRadius: '14px',
                                fontSize: '14px', fontWeight: 700, color: '#FFFFFF',
                                background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                                boxShadow: '0 4px 12px rgba(190,24,93,0.3), inset 1px 1px 3px rgba(255,255,255,0.3)',
                                border: 'none', cursor: 'pointer',
                            }}>
                                <Search size={16} />
                                Search
                            </button>
                        </div>
                    </form>
                </div>

                {/* ── Browse by specialty ── */}
                <div style={{ ...clayCard, padding: '24px 28px' }}>
                    <h2 style={sectionTitle}>
                        <Stethoscope size={17} color="#0284C7" />
                        Browse by specialty
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {CATEGORY_LINKS.map((slug) => (
                            <Link key={slug} href={`/jobs/${slug}`} style={pillStyle}>
                                {CATEGORY_LABELS[slug]}
                            </Link>
                        ))}
                        <Link href="/jobs" style={{ ...pillStyle, color: '#BE185D', background: '#FDF2F8', borderColor: 'rgba(190,24,93,0.18)' }}>
                            All categories
                        </Link>
                    </div>
                </div>

                {/* ── Browse by state ── */}
                <div style={{ ...clayCard, padding: '24px 28px' }}>
                    <h2 style={sectionTitle}>
                        <MapPin size={17} color="#059669" />
                        Browse by state
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {STATE_LINKS.map((s) => (
                            <Link key={s.slug} href={`/jobs/state/${s.slug}`} style={pillStyle}>
                                {s.name}
                            </Link>
                        ))}
                        <Link href="/jobs/locations" style={{ ...pillStyle, color: '#047857', background: '#ECFDF5', borderColor: 'rgba(5,150,105,0.18)' }}>
                            All locations
                        </Link>
                    </div>
                </div>

                {/* ── Popular destinations ── */}
                <div style={{ ...clayCard, padding: '24px 28px' }}>
                    <h2 style={sectionTitle}>
                        <Compass size={17} color="#9333EA" />
                        Popular pages
                    </h2>
                    <ul style={{
                        listStyle: 'none', margin: 0, padding: 0,
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px',
                    }}>
                        {POPULAR_PAGES.map((p) => (
                            <li key={p.href}>
                                <Link href={p.href} style={{
                                    display: 'flex', alignItems: 'center', gap: '10px',
                                    padding: '10px 10px', borderRadius: '12px',
                                    textDecoration: 'none',
                                }}>
                                    <ChevronRight size={16} color="#94A3B8" style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{p.label}</span>
                                        <span style={{ display: 'block', fontSize: '12px', color: '#64748B' }}>{p.blurb}</span>
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ── Audience split ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                    <Link href="/for-job-seekers" style={{
                        ...clayCard, padding: '20px 22px',
                        display: 'flex', alignItems: 'center', gap: '14px', textDecoration: 'none',
                    }}>
                        <div style={{
                            width: '42px', height: '42px', borderRadius: '12px',
                            background: 'linear-gradient(135deg, #E0F2FE, #BAE6FD)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                            <Search size={19} color="#0284C7" />
                        </div>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>Job seekers</span>
                            <span style={{ display: 'block', fontSize: '13px', color: '#64748B' }}>Career resources and tools</span>
                        </span>
                        <ChevronRight size={18} color="#94A3B8" />
                    </Link>

                    <Link href="/for-employers" style={{
                        ...clayCard, padding: '20px 22px',
                        display: 'flex', alignItems: 'center', gap: '14px', textDecoration: 'none',
                    }}>
                        <div style={{
                            width: '42px', height: '42px', borderRadius: '12px',
                            background: 'linear-gradient(135deg, #F3E8FF, #E9D5FF)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                            <Briefcase size={19} color="#9333EA" />
                        </div>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>Employers</span>
                            <span style={{ display: 'block', fontSize: '13px', color: '#64748B' }}>Hire {brand.niche.long}s</span>
                        </span>
                        <ChevronRight size={18} color="#94A3B8" />
                    </Link>
                </div>

                <p style={{ textAlign: 'center', margin: '4px 0 0' }}>
                    <Link href="/" style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        fontSize: '14px', fontWeight: 600, color: '#475569', textDecoration: 'none',
                    }}>
                        <Home size={16} />
                        Back to Homepage
                    </Link>
                </p>
            </div>
        </main>
    );
}

import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import FeaturedJobsSection from '@/components/FeaturedJobsSection';
import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
// D25 (2026-10-17): the comparison rows are ONE audited module, with the
// evidence for every cell in its header (pattern: lib/employer-comparison.ts).
import { SEEKER_COMPARISON_CHECKED_MONTH, SEEKER_COMPARISON_ROWS } from '@/lib/seeker-comparison';
import {
  ArrowRight, Search, Users, Briefcase, MapPin,
  Check, X, Star, DollarSign, Bell, Bookmark, FileText, SlidersHorizontal, BookOpen, Gift, Award,
} from 'lucide-react';

export const revalidate = 3600;

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
const SEEKERS_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Find Your Next ${brand.niche.short} Role`)}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: `For Job Seekers: Find Your Next ${brand.niche.short} Role`,
  // Removed the hardcoded "9,000+" job count (audit 09 M-21) — the actual
  // count drifts and a stale figure in metadata that doesn't match the
  // live UI is a credibility hit. "Thousands of verified roles" went the
  // same way (2026-10-06): it was still a count claim, just a vaguer one.
  // The description names what a seeker can do, with no number at all.
  description:
    `Find your next ${brand.niche.long} position. Search ${brand.niche.descriptor} jobs in every specialty, see pay whenever the employer posts it, get daily alerts, and read free career guides.`,
  openGraph: {
    images: [{ url: SEEKERS_OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} job seeker career resources` }],
  },
  twitter: { card: 'summary_large_image', images: [SEEKERS_OG_IMAGE] },
  alternates: { canonical: `${brand.baseUrl}/for-job-seekers` },
};

/* ═══ Design Tokens ═══ */
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

/* Hero figures come from the canonical cached SiteStat snapshot (the same
   source as the homepage), so the shared hero never shows two different
   inventories. Remote/state counts stay page-local. */
async function getStats() {
  try {
    const [site, remoteJobs, stateCount] = await Promise.all([
      getSiteStats(),
      prisma.job.count({ where: { isPublished: true, isRemote: true } }),
      prisma.job.groupBy({ by: ['state'], where: { isPublished: true, state: { not: null } } }).then(r => r.length),
    ]);
    return { totalJobs: site.totalJobs, remoteJobs, stateCount, totalCompanies: site.totalCompanies };
  } catch {
    // getSiteStats never throws (it carries its own last-resort defaults);
    // the page-local counts are omitted rather than invented.
    const site = await getSiteStats();
    return { totalJobs: site.totalJobs, remoteJobs: 0, stateCount: 0, totalCompanies: site.totalCompanies };
  }
}

/**
 * One comparison mark, as the audited /for-employers table renders it. D25
 * (2026-10-17): the old cells were bare icons a screen reader announced as
 * nothing, and "Partial" in #F59E0B with #94A3B8 greys failed AA. Each icon
 * is now decorative with the meaning in sr-only text, and "partial" reads
 * "Limited", which the caption and the footnote define
 * (tests/regressions/seeker-comparison-table.test.ts).
 */
function comparisonMark(value: true | false | 'partial', isUs: boolean) {
  if (value === true) return (
    <>
      <Check size={16} aria-hidden="true" style={{ color: isUs ? '#BE185D' : '#64748B', display: 'block', margin: '0 auto' }} />
      <span className="sr-only">Included</span>
    </>
  );
  if (value === 'partial') return <span style={{ fontSize: '11px', color: '#B45309', fontWeight: 600 }}>Limited</span>;
  return (
    <>
      <X size={16} aria-hidden="true" style={{ color: '#9CA3AF', display: 'block', margin: '0 auto' }} />
      <span className="sr-only">Not offered</span>
    </>
  );
}

/**
 * The job search guides block (2026-10-06). Each title is the post's own
 * frontmatter title in content/blog/<slug>.mdx, and each line restates what
 * that post covers, so the card never promises more than the post holds.
 * Every slug is a code-served .mdx post (see SERVING in
 * config/niche/content-map.ts), so no link here can 404 for want of a sync.
 */
interface SeekerGuide {
  slug: string;
  title: string;
  covers: string;
}

const APPLICATION_GUIDES: readonly SeekerGuide[] = [
  { slug: 'np-resume-guide', title: 'The NP Resume Guide (With a Copy-Paste Template)', covers: 'Section order, a correct credentials block, strong bullets and a template that parses cleanly.' },
  { slug: 'np-cover-letter-guide', title: 'NP Cover Letter Guide: Structure, Template and What to Skip', covers: 'Four short paragraphs, adapted to each posting.' },
  { slug: 'np-interview-questions', title: '40 NP Interview Questions With Sample Answers', covers: 'From clinical judgment to compensation, with questions to ask back.' },
  { slug: 'np-salary-negotiation-guide', title: 'NP Salary Negotiation: Scripts, RVU Models, and FPA Leverage', covers: 'Anchor on market data, value the whole package and decode RVU pay models.' },
  { slug: 'np-credentialing-checklist', title: 'NP Credentialing Checklist: Documents and Who Owns the Clock', covers: 'Credentialing, privileging and payer enrollment, and every document to assemble.' },
];

const NEW_GRAD_GUIDES: readonly SeekerGuide[] = [
  { slug: 'new-grad-np-first-job', title: 'How to Land Your First NP Job as a New Grad', covers: 'Where new grad roles come from, what a good first job looks like and how to apply.' },
  { slug: 'np-fellowship-residency-programs', title: 'Nurse Practitioner Fellowship Programs: 2026 Residency Guide', covers: 'Who accredits programs, when applications open and how to judge one against a regular first job.' },
];

function GuideList({ guides, numbered }: { guides: readonly SeekerGuide[]; numbered: boolean }) {
  const ListTag = numbered ? 'ol' : 'ul';
  return (
    <ListTag style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {guides.map((g, i) => (
        <li key={g.slug}>
          <Link href={`/blog/${g.slug}`} className="emp-bento-card seeker-guide-link" style={{
            ...clayCard, borderRadius: '14px', padding: '16px 20px', textDecoration: 'none',
            display: 'grid', gridTemplateColumns: numbered ? '32px 1fr auto' : '1fr auto', gap: '14px', alignItems: 'center',
          }}>
            {numbered && (
              <span aria-hidden="true" className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#BE185D' }}>{i + 1}</span>
            )}
            <span>
              <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '3px' }}>{g.title}</span>
              <span style={{ display: 'block', fontSize: '13px', color: '#7A6A62', lineHeight: 1.5 }}>{g.covers}</span>
            </span>
            <ArrowRight size={16} aria-hidden="true" style={{ color: '#BE185D' }} />
          </Link>
        </li>
      ))}
    </ListTag>
  );
}

export default async function ForJobSeekersPage() {
  const stats = await getStats();
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;

  return (
    <>
      <BreadcrumbSchema items={[
        { name: 'Home', url: brand.baseUrl },
        { name: 'For Job Seekers', url: `${brand.baseUrl}/for-job-seekers` },
      ]} />
      <VideoJsonLd pathname="/for-job-seekers" />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: HERO (page-local, 2026-10-06)
          This page used to mount components/HomepageHero, so it carried the
          homepage's own H1 word for word: two URLs competing for one
          heading. It now has its own H1, matched to its title, on the same
          cream graph-paper stage as the homepage and /for-employers. The
          search is a plain GET form to /jobs (the same q and location
          parameters HomepageHero sends), so it works before any script runs.
          ═══════════════════════════════════════════════════════════════ */}
      <section
        style={{
          backgroundColor: '#F5F0EB',
          backgroundImage:
            'linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          padding: '64px 0 72px',
        }}
      >
        <div style={{ maxWidth: '880px', margin: '0 auto', padding: '0 20px', textAlign: 'center' }}>
          <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#BE185D', margin: '0 0 16px' }}>
            For job seekers
          </p>
          <h1 className="font-heading" style={{
            fontSize: 'clamp(32px, 4.4vw, 52px)', fontWeight: 700, lineHeight: 1.08,
            color: '#7A1C2B', margin: '0 0 18px', letterSpacing: '-0.01em',
          }}>
            Find Your Next {brand.niche.long} Role
          </h1>
          <p style={{ fontSize: '16px', color: '#5f4a50', lineHeight: 1.7, fontWeight: 600, margin: '0 auto 28px', maxWidth: '600px' }}>
            Search {brand.niche.descriptor} and APRN jobs in every specialty, see pay whenever the employer posts it,
            and use free guides for every step from resume to first day.
          </p>

          <form action="/jobs" method="get" role="search" className="seeker-hero-search" style={{
            display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center',
            maxWidth: '720px', margin: '0 auto 22px',
          }}>
            <input
              type="search"
              name="q"
              aria-label="Job title, specialty or keyword"
              placeholder="Job title, specialty or keyword"
              style={{
                flex: '1 1 240px', minWidth: 0, padding: '14px 16px', fontSize: '15px',
                border: '2px solid #7A1C2B', background: '#FFFFFF', color: '#1A2E35',
              }}
            />
            <input
              type="text"
              name="location"
              aria-label="City or state"
              placeholder="City or state"
              style={{
                flex: '1 1 180px', minWidth: 0, padding: '14px 16px', fontSize: '15px',
                border: '2px solid #7A1C2B', background: '#FFFFFF', color: '#1A2E35',
              }}
            />
            <button type="submit" className="seeker-hero-submit" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '14px 26px', fontSize: '14px', fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              color: '#fff', background: '#BE185D',
              border: '2px solid #7A1C2B', boxShadow: '5px 5px 0 #7A1C2B', cursor: 'pointer',
            }}>
              <Search size={16} aria-hidden="true" /> Search jobs
            </button>
          </form>

          <p style={{ fontSize: '14px', color: '#5f4a50', margin: 0 }}>
            <Link href="/job-alerts" style={{ color: '#7A1C2B', fontWeight: 700 }}>Set a job alert</Link>
            {' '}or{' '}
            <Link href="#seeker-guides" style={{ color: '#7A1C2B', fontWeight: 700 }}>read the job search guides</Link>
          </p>
        </div>
      </section>

      {/* ═══ FEATURED JOBS ═══ */}
      <FeaturedJobsSection />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: BENTO FEATURES — What You Get (warm cream)
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '80px 20px 56px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            100% Free · No Hidden Fees
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '48px' }}>
            Everything You Need, For Free
          </h2>

          {/* Bento Grid */}
          <div className="seeker-bento" style={{
            display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gridTemplateRows: 'auto', gap: '14px',
          }}>
            {/* ROW 1: Licensure Guides (8 cols) + Salary (4 cols). D25
                (2026-10-17): the AI match scoring card that led this grid is
                gone. No match score reaches a job seeker, and its picture
                showed a match percentage, so neither can be reused. */}
            <div className="seeker-bento-hero-3 emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden',
              display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
            }}>
              <div style={{ padding: '32px 28px' }}>
                <div style={iconBg}>
                  <BookOpen size={24} />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>50-State Licensure Guides</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  {/* D25 (2026-10-17): dropped "salary data" from this list. A
                      guide shows state pay only in its gated market snapshot
                      (components/blog/LicenseGuideMarketSnapshot.tsx). */}
                  Requirements, board links, practice authority, and step-by-step instructions for every state.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                <Image src="/images/job-seekers/bento-guides.webp" alt="50-state licensure guides" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="seeker-bento-hero-2 emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Image src="/images/job-seekers/bento-salary.webp" alt="Salary transparency" width={200} height={140} style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
              </div>
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <div style={iconBg}>
                  <DollarSign size={22} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Salary Transparency</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  {/* Was "salary ranges on every listing": false whenever a
                      posting states no pay. Scoped to the policy llms.txt and
                      /editorial-policy state (2026-10-06). D25 (2026-10-17):
                      cut "reproduced as posted and never estimated". The
                      enrich-jobs cron fills missing pay from an AI read of
                      the description, annualized, and marks it estimated. */}
                  Pay is shown whenever the employer&apos;s posting includes it.
                </p>
              </div>
            </div>

            {/* ROW 2: 4 compact cards (3 cols each) */}
            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <Bell size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Daily Job Alerts</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>New jobs matching your criteria, delivered to your inbox daily.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <SlidersHorizontal size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Application Tracking</h3>
              {/* D25 (2026-10-17): was "Track every application status from
                  Applied to Hired". Only an employer moves a status, and an
                  application finished on an employer's own site stays at
                  Applied (app/api/employer/applicants/route.ts). */}
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Your applications in one list, with any status updates from the employer.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <FileText size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>AI Resume Parser</h3>
              {/* D25 (2026-10-17): was "AI fills in your profile instantly". A
                  parse can take minutes, and the profile changes only after
                  the seeker reviews a preview (app/api/resume/parse/route.ts). */}
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Upload your resume, check what AI reads from it, then add it to your profile.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <Bookmark size={22} />
              </div>
              {/* D25 (2026-10-17): was "Save & Compare". Saved jobs have no
                  comparison feature. */}
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Saved Jobs</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Bookmark jobs and come back to them when you are ready to apply.</p>
            </div>

            {/* ROW 3: the free band (12 cols), now that the Licensure card
                sits in row 1. D25 (2026-10-17): was "Free Forever". Free for job
                seekers is true today and is the table's row, but "Forever"
                is a promise the owner has not made, and the autofill
                extension code already defines paid tiers
                (app/api/autofill/_lib/quota.ts). */}
            <div className="seeker-bento-free emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 12',
              padding: '24px 28px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px',
              background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
              border: '2px solid rgba(190,24,93,0.15)',
            }}>
              <div style={{ ...iconBg, background: 'rgba(190,24,93,0.1)', color: '#BE185D', marginBottom: 0, flexShrink: 0 }}>
                <Gift size={22} />
              </div>
              <div style={{ flex: '1 1 260px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#831843', margin: '0 0 4px' }}>Free for Job Seekers</h3>
                <p style={{ fontSize: '13px', color: '#BE185D', margin: 0, lineHeight: 1.6, fontWeight: 500 }}>
                  No subscriptions. No premium tiers.
                </p>
              </div>
              <Link href="/jobs" className="seeker-cta-primary" style={{
                padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                background: '#BE185D', color: '#fff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
              }}>
                Start Searching <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: EXPLORE JOB TYPES (warm peach)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #FDE8D8 0%, #F5D0B5 40%, #FDE8D8 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Explore Opportunities
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '44px' }}>
            Find Your Ideal Work Setting
          </h2>

          <div className="seeker-types-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { title: 'Remote / Telehealth', desc: 'See patients from anywhere via telehealth', href: '/jobs?mode=Remote', img: '/images/job-seekers/remote-telehealth.webp' },
              { title: 'In-Person Clinical', desc: 'Hospital, clinic, and outpatient roles', href: '/jobs?mode=In-Person', img: '/images/job-seekers/clinical-inperson.webp' },
              { title: 'Private Practice', desc: 'Start or join a private practice', href: '/resources/private-practice-guide', img: '/images/job-seekers/private-practice.webp' },
              { title: 'Part-Time / PRN', desc: 'Flexible schedules and per diem', href: '/jobs?jobType=Part-Time', img: '/images/job-seekers/parttime-prn.webp' },
            ].map(t => (
              <Link key={t.title} href={t.href} className="emp-bento-card" style={{
                ...clayCard, padding: '0', overflow: 'hidden', textDecoration: 'none', display: 'block',
              }}>
                <div style={{ position: 'relative', aspectRatio: '4/3', overflow: 'hidden' }}>
                  <Image src={t.img} alt={t.title} fill className="object-cover" sizes="(max-width: 768px) 50vw, 25vw" />
                </div>
                <div style={{ padding: '20px 18px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{t.title}</h3>
                  <p style={{ fontSize: '12px', color: '#7A6A62', margin: '0 0 10px', lineHeight: 1.5 }}>{t.desc}</p>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#BE185D' }}>Explore →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6: COMPARISON TABLE + CTA (slate)
          D25 (2026-10-17): the rows come from lib/seeker-comparison.ts,
          which records why each cell is what it is. The markup is the
          audited /for-employers table: a caption that defines Limited,
          scoped headers, text for every icon, AA colours, and a dated
          footnote with a correction link. The "Why Switch" eyebrow went
          with the old rows: Indeed matches us in three of the five rows and
          LinkedIn in one, so the table no longer argues for leaving either.
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '44px' }}>
            How We Compare
          </h2>

          <div className="seeker-compare-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>
            {/* Comparison Table */}
            <div className="seeker-compare-table" style={{ ...clayCard, padding: '0', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
                <caption className="sr-only">
                  Feature comparison between {brand.name}, Indeed, and LinkedIn for {brand.niche.descriptor} job
                  seekers. &quot;Limited&quot; means the capability exists but is restricted, costs extra, or varies by plan.
                </caption>
                <thead>
                  <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                    <th scope="col" style={{ width: '40%', padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                    <th scope="col" style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 800, color: '#BE185D', borderBottom: '2px solid rgba(190,24,93,0.2)', fontSize: '12px' }}>{brand.name}</th>
                    <th scope="col" style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>Indeed</th>
                    <th scope="col" style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>LinkedIn</th>
                  </tr>
                </thead>
                <tbody>
                  {SEEKER_COMPARISON_ROWS.map((row, i) => (
                    <tr key={row.feature} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      <th scope="row" style={{ padding: '12px 24px', borderBottom: '1px solid rgba(0,0,0,0.04)', textAlign: 'left', fontWeight: 500 }}>
                        <span style={{ color: '#1A2E35', fontWeight: 500 }}>{row.feature}</span>
                        {row.note && <span style={{ display: 'block', fontSize: '11px', color: '#64748B', marginTop: '2px', fontWeight: 400 }}>{row.note}</span>}
                      </th>
                      <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(190,24,93,0.03)' }}>
                        {comparisonMark(row.us, true)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        {comparisonMark(row.indeed, false)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        {comparisonMark(row.linkedin, false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {/* Honesty footnote, as on /for-employers, plus the month the
                  competitor columns were last checked against their own pages. */}
              <p style={{ fontSize: '11.5px', color: '#64748B', lineHeight: 1.6, margin: 0, padding: '14px 24px 18px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <strong style={{ color: '#475569' }}>Limited</strong> means the capability exists but is restricted,
                costs extra, or varies by plan. The Indeed and LinkedIn columns describe their publicly documented
                standard offerings as of {SEEKER_COMPARISON_CHECKED_MONTH}. These change often, so check their sites
                before deciding. Spot something out of date?{' '}
                <a href={`mailto:${brand.email.contact}`} style={{ color: '#BE185D', textDecoration: 'underline' }}>
                  Tell us
                </a>{' '}
                and we will correct it.
              </p>
            </div>

            {/* CTA Card */}
            <div style={{
              ...clayCard, padding: '0', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Image
                  src="/images/job-seekers/cta-dream-role.webp"
                  alt={`Start your ${brand.niche.short} job search`}
                  width={280} height={220}
                  style={{ width: '100%', maxWidth: '260px', height: 'auto', borderRadius: '14px' }}
                />
              </div>
              <div style={{ padding: '28px 24px' }}>
                <h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>
                  Ready to Find Your{' '}
                  <span style={{ color: '#BE185D' }}>Dream Role</span>?
                </h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 20px' }}>
                  {/* D25 (2026-10-17): "and get matched" rested on the removed
                      match scoring row. */}
                  100% free. No sign-up required to browse. Create a profile to apply.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <Link href="/jobs" className="seeker-cta-primary" style={{
                    padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px',
                    background: 'linear-gradient(145deg, #BE185D, #9D174D)', color: '#fff',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: '4px 4px 12px rgba(190,24,93,0.2), inset 1px 1px 2px rgba(255,255,255,0.15)',
                  }}>
                    Browse Jobs <ArrowRight size={15} />
                  </Link>
                  <Link href="/salary-guide" className="seeker-cta-secondary" style={{
                    padding: '12px 24px', borderRadius: '12px', fontWeight: 600, fontSize: '14px',
                    background: '#fff', color: '#1A2E35', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    border: '1px solid rgba(0,0,0,0.08)', boxShadow: '2px 2px 6px rgba(0,0,0,0.04)',
                  }}>
                    <Star size={14} /> Salary Guide
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6b: JOB SEARCH GUIDES (cream). The application funnel in
          order, then the two guides for new graduates.
          ═══════════════════════════════════════════════════════════════ */}
      <section id="seeker-guides" aria-labelledby="seeker-guides-heading" style={{ background: '#FDFBF7', padding: '80px 20px', scrollMarginTop: '96px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Job Search Guides
          </p>
          <h2 id="seeker-guides-heading" className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
            From Application to First Day
          </h2>

          <div className="seeker-guides-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '28px', alignItems: 'start' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#7A1C2B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                Apply, interview and start
              </h3>
              <GuideList guides={APPLICATION_GUIDES} numbered />
            </div>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#7A1C2B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                If you are a new graduate
              </h3>
              <GuideList guides={NEW_GRAD_GUIDES} numbered={false} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 7: CAREER RESOURCES (clay cards on warm bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 50%, #FFF5EE 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Career Resources
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '44px' }}>
            Tools Built for Your {brand.niche.short} Career
          </h2>

          <div className="seeker-resource-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {[
              {
                title: `2026 ${brand.niche.short} Salary Guide`,
                // D25 (2026-10-17): was "State-by-state salary data ... See what
                // NPs actually earn". A state shows a median only above the
                // publishing gate (components/tools/benchmark-model.ts), and the
                // state figures are posted pay, not earnings.
                desc: 'National pay data, posted pay by state where enough listings show it, experience-based ranges, and negotiation strategies.',
                href: '/salary-guide',
                IconComponent: DollarSign,
                iconColor: '#BE185D',
                gradient: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                cta: 'View Salary Data',
              },
              {
                title: '50-State Licensure Guides',
                // 2026-10-06: "processing times for every state" overclaimed;
                // the series quotes a processing time only where a dated,
                // cited licensing fact exists (lib/blog-license-guides.ts).
                desc: 'Practice authority, the APRN licensure path and board links for every state, with dated licensing facts where we have verified them.',
                href: '/resources',
                IconComponent: BookOpen,
                iconColor: '#EA580C',
                gradient: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)',
                cta: 'Check Your State',
              },
              {
                title: `${brand.niche.short} Career Blog`,
                // 2026-10-06: "written by NPs for NPs" named an authorship the
                // site cannot show (brand.editorial.author is unset; see
                // config/brand.ts). The claim now matches /editorial-policy.
                desc: 'Interview tips, resume advice, CE requirements, and industry trends, with cited figures that carry a source and a date.',
                href: '/blog',
                IconComponent: FileText,
                iconColor: '#4F46E5',
                gradient: 'linear-gradient(145deg, #EEF2FF, #E0E7FF)',
                cta: 'Read Articles',
              },
              {
                title: 'Full Practice Authority Guide',
                // CQ-13: the concept guide; each state's rule is on /scope-of-practice.
                desc: 'What full practice authority means, and how full, reduced and restricted practice differ.',
                href: '/resources/fpa-guide',
                IconComponent: Award,
                iconColor: '#D97706',
                gradient: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)',
                cta: 'Learn About FPA',
              },
            ].map(r => {
              const IconComp = r.IconComponent;
              return (
                <Link key={r.title} href={r.href} className="emp-bento-card" style={{
                  ...clayCard, padding: '0', overflow: 'hidden', textDecoration: 'none',
                  display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center',
                }}>
                  <div style={{ background: r.gradient, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <div style={{
                      width: '52px', height: '52px', borderRadius: '14px', background: '#FFFFFF',
                      color: r.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.06)',
                    }}>
                      <IconComp size={26} />
                    </div>
                  </div>
                  <div style={{ padding: '20px 22px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{r.title}</h3>
                    <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: '0 0 10px', lineHeight: 1.55 }}>{r.desc}</p>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#BE185D', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {r.cta} <ArrowRight size={12} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ Responsive overrides ═══ */}
      <style>{`
        .seeker-cta-primary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
        }
        .seeker-cta-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 32px rgba(190,24,93,0.35), inset 1px 1px 2px rgba(255,255,255,0.2) !important;
          filter: brightness(1.05);
        }
        .seeker-cta-secondary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .seeker-cta-secondary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.08) !important;
          border-color: rgba(190,24,93,0.3) !important;
        }
        .seeker-stat-pill {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .seeker-stat-pill:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important;
        }
        .seeker-hero-submit {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .seeker-hero-submit:hover {
          transform: translate(-2px, -2px);
          box-shadow: 7px 7px 0 #7A1C2B !important;
        }
        .seeker-hero-submit:active {
          transform: translate(3px, 3px);
          box-shadow: 2px 2px 0 #7A1C2B !important;
        }
        .seeker-hero-search input:focus-visible,
        .seeker-hero-submit:focus-visible,
        .seeker-guide-link:focus-visible {
          outline: 3px solid #BE185D;
          outline-offset: 2px;
        }
        .seeker-guide-link {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .seeker-guide-link:hover {
          transform: translateX(3px);
        }
        @media (prefers-reduced-motion: reduce) {
          .seeker-hero-submit, .seeker-guide-link { transition: none; }
          .seeker-hero-submit:hover, .seeker-hero-submit:active, .seeker-guide-link:hover { transform: none; }
        }
        .seeker-compare-table tr {
          transition: background 0.2s ease;
        }
        .seeker-compare-table tbody tr:hover {
          background: rgba(190,24,93,0.04) !important;
        }

        @media (max-width: 768px) {
          .seeker-compare-grid { grid-template-columns: 1fr !important; }
          .seeker-guides-grid { grid-template-columns: 1fr !important; }
          .seeker-hero-submit { flex: 1 1 100%; }
          .seeker-types-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .seeker-resource-grid { grid-template-columns: 1fr !important; }
          .seeker-bento { grid-template-columns: 1fr !important; }
          .seeker-bento-hero-2, .seeker-bento-hero-3, .seeker-bento-free {
            grid-column: span 1 !important;
          }
          .seeker-bento-hero-3 {
            grid-template-columns: 1fr !important;
          }
          .seeker-bento > div { grid-column: span 1 !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .seeker-bento { grid-template-columns: repeat(6, 1fr) !important; }
          .seeker-bento-hero-3 { grid-column: span 6 !important; }
          .seeker-bento-hero-2, .seeker-bento-free { grid-column: span 6 !important; }
          .seeker-bento > div:not(.seeker-bento-hero-2):not(.seeker-bento-hero-3):not(.seeker-bento-free) {
            grid-column: span 3 !important;
          }
          .seeker-types-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </>
  );
}

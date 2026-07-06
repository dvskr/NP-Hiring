import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Building2, Bell, ArrowRight } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { buildCategoryWhereClause } from '@/lib/filters';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import CategoryHero from '@/components/CategoryHero';
import CategoryLocationsExplore from '@/components/seo/CategoryLocationsExplore';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const STORAGE_BASE = brand.assets.storageBase;

const clayCard: React.CSSProperties = { background: '#FFFFFF', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)' };
export const revalidate = 3600;
interface EmployerGroupResult { employer: string; _count: { employer: number }; }
interface ProcessedEmployer { name: string; count: number; }

const TV_FILTER = buildCategoryWhereClause('travel');

async function getJobs(skip = 0, take = 20) { return prisma.job.findMany({ where: TV_FILTER, orderBy: BEST_SORT_ORDER_BY, skip, take }); }
async function getStats() {
  const totalJobs = await prisma.job.count({ where: TV_FILTER });
  const salaryData = await prisma.job.aggregate({ where: { ...TV_FILTER, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } }, _avg: { normalizedMinSalary: true, normalizedMaxSalary: true } });
  const avgSalary = Math.round(((salaryData._avg.normalizedMinSalary || 0) + (salaryData._avg.normalizedMaxSalary || 0)) / 2 / 1000);
  const topEmployers = await prisma.job.groupBy({ by: ['employer'], where: TV_FILTER, _count: { employer: true }, orderBy: { _count: { employer: 'desc' } }, take: 8 });
  return { totalJobs, avgSalary, topEmployers: topEmployers.map((e: EmployerGroupResult) => ({ name: e.employer, count: e._count.employer })) };
}

const faqs = [
  { q: `What is a Travel ${brand.niche.short}?`, a: `An ${brand.niche.short} who takes temporary assignments (8-26 weeks) at healthcare facilities across the country through staffing agencies.` },
  { q: 'What is the pay like?', a: `Travel ${brand.niche.short}s generally earn more than comparable permanent staff, plus tax-free housing stipends, travel reimbursement, and completion bonuses. Pay packages vary by state, specialty, and setting.` },
  { q: 'Is housing provided?', a: 'Yes, most agencies offer furnished housing or generous housing stipends. Meals and incidental per diems are also common.' },
  { q: 'Do I need multi-state licenses?', a: 'You need APRN licensure in each state where you take an assignment. Most agencies handle the licensure paperwork and often reimburse application fees.' },
  { q: 'How long are typical assignments?', a: `Most travel ${brand.niche.short} assignments are 13 weeks (one quarter), though 8-week and 26-week contracts are also common. Extensions are frequently offered if the facility and provider are a good fit.` },
];

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [stats, params] = await Promise.all([getStats(), searchParams]);
  const page = Math.max(1, parseInt(params.page || '1'));
  return {
    title: `${stats.totalJobs} Travel ${brand.niche.short} Jobs — Nationwide Assignments`,
    description: `Find ${stats.totalJobs} travel ${brand.niche.short} and locum tenens positions. Housing stipends, flexible nationwide assignments, and premium pay packages. Updated daily.`,
    keywords: ['travel np jobs', 'travel nurse practitioner', 'locum tenens nurse practitioner', 'traveling np positions'],
    alternates: { canonical: `${brand.baseUrl}/jobs/travel` },
    ...(page > 1 && { robots: { index: false, follow: true } }),
  };
}

interface PageProps { searchParams: Promise<{ page?: string }>; }

export default async function TravelJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const skip = (Math.max(1, parseInt(params.page || '1')) - 1) * 10;
  const [jobs, stats] = await Promise.all([getJobs(skip, 10), getStats()]);

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      <BreadcrumbSchema items={[{ name: "Home", url: brand.baseUrl }, { name: "Jobs", url: `${brand.baseUrl}/jobs` }, { name: "Travel", url: `${brand.baseUrl}/jobs/travel` }]} />
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName="Travel Jobs" />
      {jobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: `Travel ${brand.niche.short} Jobs`, numberOfItems: stats.totalJobs, itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({ '@type': 'ListItem', position: idx + 1, name: job.title, url: `${brand.baseUrl}/jobs/${job.slug || job.id}` })) }) }} />
      )}

      {/* 1. HERO */}
      <CategoryHero
        bgColor="#81c1da"
        heroImage={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_travel.webp`}
        heroAlt={`Travel ${brand.niche.short} nationwide assignments`}
        badgeText={`${stats.totalJobs} live roles · updated today`}
        breadcrumbs={['Careers', 'Nurse Practitioner', 'Travel']}
        indexLabel={`№ ${String(ALL_CATEGORY_SLUGS.indexOf('travel') + 1).padStart(2, '0')} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="Travel"
        headlineLine2={brand.niche.short}
        headlineSub="jobs, explore the country."
        stats={[
          { value: `${stats.totalJobs}+`, label: 'positions' },
          { value: stats.avgSalary > 0 ? `$${stats.avgSalary}k` : '$60/hr+', label: 'avg salary' },
          { value: `${stats.topEmployers.length}+`, label: 'agencies' },
        ]}
        description="Travel assignments with premium pay, furnished housing, and the freedom to explore new locations nationwide."
        ctaLabel="Browse Travel Jobs"
        ctaHref="/jobs?category=travel"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* 2. JOB LISTINGS */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>Travel Positions ({stats.totalJobs})</h2>
            {jobs.length > 0 ? (<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">{jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}</div>) : (<div className="text-center py-12"><p style={{ color: '#7A6A62' }}>No positions right now.</p></div>)}
            <div style={{ textAlign: 'center', marginTop: '32px' }}><Link href="/jobs?category=travel" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>Browse All Travel Jobs <ArrowRight size={16} /></Link></div>
          </div>
          <div className="lg:col-span-1">
            <div style={{ ...clayCard, padding: '24px', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}><Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} /><h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Travel Alerts</h3><p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px' }}>New travel assignments daily.</p><Link href="/job-alerts" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link></div>
            {stats.topEmployers.length > 0 && (<div style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}><Building2 size={20} style={{ color: '#BE185D', marginBottom: '8px' }} /><h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>Top Employers</h3><ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{stats.topEmployers.map((employer: ProcessedEmployer, index: number) => (<li key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: index < stats.topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}><span style={{ fontSize: '13px', color: '#5A4A42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{employer.name}</span><span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', marginLeft: '8px' }}>{employer.count}</span></li>))}</ul></div>)}
            {stats.avgSalary > 0 && (<div style={{ ...clayCard, padding: '24px' }}><TrendingUp size={20} style={{ color: '#34D399', marginBottom: '8px' }} /><div style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35' }}>${stats.avgSalary}k</div><div style={{ fontSize: '13px', color: '#7A6A62' }}>Average salary</div></div>)}
          </div>
        </div>
      </div>

      {/* 3. BENTO GRID */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose Travel</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '48px' }}>Built for Adventure</h2>
          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            <div className="cat-bento-hero-1" style={{ ...clayCard, gridColumn: 'span 8', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' }}>
              <div><h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Explore the Country</h3><p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>Take 8-26 week assignments at top facilities nationwide. Experience new cities, cultures, and clinical environments while building a diverse resume.</p></div>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_adventure.webp`} alt={`Travel ${brand.niche.short} exploring new locations`} width={280} height={200} style={{ width: '100%', height: 'auto', borderRadius: '14px' }} />
            </div>
            <div className="cat-bento-hero-2" style={{ ...clayCard, gridColumn: 'span 4', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_housing.webp`} alt="Furnished housing provided" width={200} height={140} style={{ width: '100%', maxWidth: '180px', height: 'auto', borderRadius: '12px', marginBottom: '16px' }} />
              <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Housing Included</h3>
              <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Furnished housing or generous stipends with every assignment.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_case.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Travel Ready</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Pack your bags for assignments across the country.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_plane.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Nationwide</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Work in all 50 states with agency-supported licensure.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_housing.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Stipends</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Tax-free housing, meals, and travel reimbursements.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_dollar.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Premium Pay</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Pay packages that typically beat comparable permanent roles.</p></div>
            <div className="cat-bento-hero-3" style={{ ...clayCard, gridColumn: 'span 8', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' }}>
              <div><TrendingUp size={28} style={{ color: '#34D399', marginBottom: '12px' }} /><h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Travel Pay</h3><p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '0 0 6px' }}>Average travel {brand.niche.short} salary:</p><p style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>${stats.avgSalary}k</p></div>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_compensation.webp`} alt={`Travel ${brand.niche.short} compensation`} width={280} height={200} style={{ width: '100%', height: 'auto', borderRadius: '14px' }} />
            </div>
            <div className="cat-bento-cta" style={{ ...clayCard, gridColumn: 'span 4', padding: '28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
              <Bell size={32} style={{ color: '#BE185D', marginBottom: '14px' }} /><h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 10px' }}>Get Travel Alerts</h3><p style={{ fontSize: '13px', color: '#BE185D', lineHeight: 1.6, margin: '0 0 20px' }}>New assignments posted daily.</p>
              <Link href="/job-alerts" className="cat-cta-primary" style={{ padding: '12px 28px', borderRadius: '12px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 10px rgba(190,24,93,0.2)' }}>Create Alert</Link>
            </div>
          </div>
        </section>
      </div>

      {/* 4. BEFORE YOU APPLY */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>What You Need to Know</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[{ n: '01', t: 'Multi-State License', d: 'Start licensure early in target states — agencies often assist with applications and fees.' }, { n: '02', t: 'Travel Docs', d: 'Keep CV, certs, and references ready for quick credentialing.' }, { n: '03', t: 'Tax Home', d: 'Establish a tax home for maximum tax-free stipend benefits.' }, { n: '04', t: 'Agency Research', d: 'Compare staffing agencies for pay packages and support.' }].map(item => (
              <div key={item.n} className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}><span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3' }}>{item.n}</span><h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginTop: '12px', marginBottom: '8px' }}>{item.t}</h3><p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{item.d}</p></div>
            ))}
          </div>
        </section>
      </div>

      {/* 5. EXPLORE */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Categories</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[{ href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` }, { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` }, { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Short-term fills', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` }, { href: '/jobs/contract', label: 'Contract', sub: 'Fixed-term roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` }, { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` }, { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` }].map(c => (
              <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center' }}><Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} /><span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span><span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span></Link>
            ))}
          </div>
        </section>
      </div>

      {/* By Location — pseoStats-gated internal links */}

      <CategoryLocationsExplore categorySlug="travel" categoryLabel="Travel" />


      {/* 6. FAQ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Travel {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>{faqs.map((faq, idx) => (<div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}><h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.q}</h3><p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.a}</p></div>))}</div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }) }} />
        </section>
      </div>

      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        @media (max-width: 768px) { .cat-hero-grid { grid-template-columns: 1fr !important; } .cat-bento-grid { grid-template-columns: 1fr !important; } .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-cta { grid-column: span 1 !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; } .cat-bento-grid > div { grid-column: span 1 !important; } .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (min-width: 769px) and (max-width: 1024px) { .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-column: span 6 !important; } .cat-bento-hero-2, .cat-bento-cta { grid-column: span 6 !important; } .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-cta) { grid-column: span 3 !important; } }
      `}</style>
    </div>
  );
}

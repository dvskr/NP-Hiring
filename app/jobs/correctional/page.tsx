import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Shield, TrendingUp, Building2, Bell, ArrowRight } from 'lucide-react';
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

/* Design Tokens */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export const revalidate = 3600;

interface EmployerGroupResult {
  employer: string;
  _count: { employer: number };
}

interface ProcessedEmployer {
  name: string;
  count: number;
}

const CORRECTIONAL_FILTER = buildCategoryWhereClause('correctional');

async function getCorrectionalJobs(skip: number = 0, take: number = 20) {
  return prisma.job.findMany({
    where: CORRECTIONAL_FILTER,
    orderBy: BEST_SORT_ORDER_BY,
    skip,
    take,
  });
}

async function getCorrectionalStats() {
  const totalJobs = await prisma.job.count({ where: CORRECTIONAL_FILTER });

  const salaryData = await prisma.job.aggregate({
    where: { ...CORRECTIONAL_FILTER, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } },
    _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
  });

  const avgMinSalary = salaryData._avg.normalizedMinSalary || 0;
  const avgMaxSalary = salaryData._avg.normalizedMaxSalary || 0;
  const avgSalary = Math.round((avgMinSalary + avgMaxSalary) / 2 / 1000);

  const topEmployers = await prisma.job.groupBy({
    by: ['employer'],
    where: CORRECTIONAL_FILTER,
    _count: { employer: true },
    orderBy: { _count: { employer: 'desc' } },
    take: 8,
  });

  const processedEmployers = topEmployers.map((e: EmployerGroupResult) => ({
    name: e.employer,
    count: e._count.employer,
  }));

  return { totalJobs, avgSalary, topEmployers: processedEmployers };
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [stats, params] = await Promise.all([getCorrectionalStats(), searchParams]);
  const page = parseInt(params.page || '1');

  return {
    title: `${stats.totalJobs} Correctional ${brand.niche.short} Jobs — Prison & Jail Healthcare`,
    // SEO Fix #7: trim description to ≤160 chars.
    description: `Find ${stats.totalJobs} correctional ${brand.niche.short} jobs in prisons, jails, and detention facilities. Structured schedules, strong benefits, and loan forgiveness eligibility.`,
    keywords: ['correctional np jobs', 'prison nurse practitioner', 'jail NP jobs', 'correctional healthcare nurse practitioner', 'corrections NP jobs'],
    openGraph: {
      title: `${stats.totalJobs} Correctional ${brand.niche.short} Jobs`,
      description: `Browse correctional healthcare ${brand.niche.descriptor} positions.`,
      type: 'website',
      url: `${brand.baseUrl}/jobs/correctional`,
      images: [{
        url: `/api/og?type=page&title=${encodeURIComponent(`${stats.totalJobs} Correctional ${brand.niche.short} Jobs`)}&subtitle=${encodeURIComponent('Correctional healthcare NP positions with PSLF eligibility')}`,
        width: 1200, height: 630, alt: `Correctional ${brand.niche.short} Jobs`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${stats.totalJobs} Correctional ${brand.niche.short} Jobs`,
      description: `Correctional ${brand.niche.short} positions in prisons, jails, and detention facilities.`,
    },
    alternates: { canonical: `${brand.baseUrl}/jobs/correctional` },
    ...(page > 1 && { robots: { index: false, follow: true } }),
  };
}

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function CorrectionalJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1'));
  const limit = 10;
  const skip = (page - 1) * limit;

  const [jobs, stats] = await Promise.all([getCorrectionalJobs(skip, limit), getCorrectionalStats()]);
  const totalPages = Math.ceil(stats.totalJobs / limit);

  const correctionalFaqs = [
    {
      question: `What do correctional ${brand.niche.short}s do?`,
      answer: `Correctional ${brand.niche.short}s provide healthcare to incarcerated individuals in prisons, jails, and detention facilities. They conduct health assessments, manage chronic and acute conditions, prescribe medications, respond to urgent medical needs, and develop treatment plans. They often care for patients with complex needs, including co-occurring chronic disease, mental health conditions, and substance use disorders.`
    },
    {
      question: `How much do correctional ${brand.niche.short}s earn?`,
      answer: `Correctional ${brand.niche.short} pay is often at or above typical NP rates because facilities compete for a limited applicant pool, and government roles carry strong benefits. Federal Bureau of Prisons positions add federal pension, health insurance, and student loan repayment program eligibility.`
    },
    {
      question: `Is working as a correctional ${brand.niche.short} dangerous?`,
      answer: `Correctional facilities have security protocols to protect healthcare providers. While the environment requires awareness and de-escalation skills, most ${brand.niche.short}s report feeling safe. Facilities provide training on security procedures, and healthcare providers are typically respected by the incarcerated population.`
    },
    {
      question: `Do you need special certification for correctional ${brand.niche.short} work?`,
      answer: "No specialty certification is required — an active APRN license and national NP certification are the baseline, and most employers provide facility-specific orientation and security training. Experience with chronic disease management, substance use treatment, and complex patient populations is highly valued."
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Jobs", url: `${brand.baseUrl}/jobs` },
        { name: "Correctional", url: `${brand.baseUrl}/jobs/correctional` }
      ]} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: correctionalFaqs.map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: { '@type': 'Answer', text: faq.answer },
            })),
          }),
        }}
      />
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: `Correctional ${brand.niche.short} Jobs`,
              numberOfItems: stats.totalJobs,
              itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
              })),
            }),
          }}
        />
      )}
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName={`Correctional ${brand.niche.short} Jobs`} />

      {/* ═══ HERO ═══ */}
      <CategoryHero
        bgColor="#95aabd"
        heroImage={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_v2_correctional.webp`}
        heroAlt={`Correctional ${brand.niche.short} in a secure facility`}
        badgeText={`${stats.totalJobs} live roles · updated today`}
        breadcrumbs={['Careers', 'Nurse Practitioner', 'Correctional']}
        indexLabel={`№ ${ALL_CATEGORY_SLUGS.indexOf('correctional') + 1} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="Correctional"
        headlineLine2={brand.niche.short}
        headlineSub="jobs, secure settings."
        stats={[
          { value: `${stats.totalJobs}+`, label: 'positions' },
          { value: stats.avgSalary > 0 ? `$${stats.avgSalary}k` : '$120K+', label: 'avg salary' },
          { value: `${stats.topEmployers.length}+`, label: 'employers' },
        ]}
        description="Correctional healthcare positions with structured schedules, high autonomy, and federal loan forgiveness eligibility."
        ctaLabel="Browse Correctional Jobs"
        ctaHref="/jobs?category=correctional"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* ═══ JOB LISTINGS ═══ */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>Correctional Positions ({stats.totalJobs})</h2>
              <Link href="/jobs" className="text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'var(--color-primary)' }}>View All Jobs →</Link>
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <Shield className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No correctional positions at this time</h3>
                <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>New correctional {brand.niche.short} openings are added daily.</p>
                <Link href="/jobs" className="inline-block px-6 py-3 text-white rounded-lg font-medium" style={{ backgroundColor: 'var(--color-primary)' }}>Browse All Jobs</Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}
                </div>
              </>
            )}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <Link href="/jobs?category=correctional" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>
                Browse All Correctional Jobs <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="cat-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <div style={{ padding: '24px' }}>
                <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Correctional Alerts</h3>
                <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New correctional healthcare listings daily.</p>
                <Link href="/job-alerts" className="cat-cta-primary" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 8px rgba(190,24,93,0.15)' }}>Create Alert</Link>
              </div>
            </div>
            {stats.topEmployers.length > 0 && (
              <div className="cat-bento-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Building2 size={20} style={{ color: '#BE185D' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Top Employers</h3>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stats.topEmployers.map((employer: ProcessedEmployer, index: number) => (
                    <li key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: index < stats.topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                      <span style={{ fontSize: '13px', color: '#5A4A42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{employer.name}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', marginLeft: '8px', whiteSpace: 'nowrap' }}>{employer.count} {employer.count === 1 ? 'job' : 'jobs'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stats.avgSalary > 0 && (
              <div className="cat-bento-card" style={{ ...clayCard, padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <TrendingUp size={20} style={{ color: '#34D399' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Salary Insights</h3>
                </div>
                <div style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35', lineHeight: 1 }}>${stats.avgSalary}k</div>
                <div style={{ fontSize: '13px', color: '#7A6A62', marginTop: '4px' }}>Average annual salary</div>
                <p style={{ fontSize: '11px', color: '#A09080', marginTop: '12px' }}>Correctional roles often pay above typical NP rates.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ BENTO — Why Choose Correctional ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose Correctional</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>Built for Justice-Involved Care</h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>Correctional healthcare offers structured schedules, loan repayment, and impact on a deeply underserved population.</p>

          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: Secure Facility (8) + Loan Repayment (4) */}
            <div className="cat-bento-hero-1 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
              <div style={{ padding: '32px 28px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Secure Facility Care</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  Work in structured correctional medical units with full security support, set patient panels, and predictable schedules.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_facility.webp`} alt="Correctional facility medical unit" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="cat-bento-hero-2 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_loan.webp`} alt="Student loan forgiveness" width={200} height={140} style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
              </div>
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Loan Repayment</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  NHSC loan repayment up to $50K. Many federal positions qualify for PSLF.
                </p>
              </div>
            </div>

            {/* ROW 2: 4 clay icon cards (3 cols each) */}
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_structured.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Structured Setting</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Predictable schedules in jails, prisons, and detention centers with set patient panels.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_loan.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Competitive Pay</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Hard-to-fill settings often pay above typical {brand.niche.short} rates, with strong federal and state benefits.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_security.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Security Provided</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Full custody support, safety protocols, and security training provided.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_pathology.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Complex Case Mix</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Manage chronic disease, infectious disease, substance use, and mental health needs in one panel.</p>
            </div>

            {/* ROW 3: Salary (8) + Alert CTA (4) */}
            <div className="cat-bento-hero-3 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
              <div style={{ padding: '32px 28px' }}>
                <TrendingUp size={28} style={{ color: '#BE185D', marginBottom: '16px' }} />
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Salary + Benefits</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>Correctional {brand.niche.short}s earn {stats.avgSalary > 0 ? `$${stats.avgSalary}k` : '$95K–$160K'} annually, and government roles add pension, health insurance, and loan repayment.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_salary.webp`} alt={`Correctional ${brand.niche.short} salary premium`} width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="cat-bento-cta cat-bento-card" style={{
              ...clayCard, gridColumn: 'span 4', padding: '28px 22px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)',
            }}>
              <Bell size={32} style={{ color: '#BE185D', marginBottom: '14px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#831843', margin: '0 0 6px' }}>Job Alerts</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', margin: '0 0 16px', lineHeight: 1.6, fontWeight: 500 }}>
                New correctional listings delivered to your inbox daily.
              </p>
              <Link href="/job-alerts" className="cat-cta-primary" style={{
                padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                background: '#BE185D', color: '#fff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
              }}>
                Create Alert <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ═══ BEFORE YOU APPLY ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>What You Need to Know</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              <div key="01" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>01</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>Background Check</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Prepare for extensive background investigation required for correctional facility clearance.</p>
              </div>
              <div key="02" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>02</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>Formulary Review</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Understand restricted formularies common in correctional settings and prescribing limitations.</p>
              </div>
              <div key="03" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>03</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>Safety Training</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Complete required safety orientation including crisis intervention and de-escalation training.</p>
              </div>
              <div key="04" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>04</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>NHSC Application</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Apply for National Health Service Corps loan repayment to maximize correctional benefits.</p>
              </div>
          </div>
        </section>
      </div>

      {/* ═══ EXPLORE MORE ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Ways to Find Your Next Role</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
              { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
              { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
              { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
              { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
              { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
            ].map(c => (
              <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                <Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* By Location — pseoStats-gated internal links */}

      <CategoryLocationsExplore categorySlug="correctional" categoryLabel="Correctional" />


      {/* ═══ FAQ ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Correctional {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>
            {correctionalFaqs.map((faq, idx) => (
              <div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px 28px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.question}</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ Responsive + Hover CSS ═══ */}
      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .cat-stat-pill { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .cat-stat-pill:hover { transform: translateY(-2px) scale(1.02); box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important; }
        @media (max-width: 768px) {
          .cat-hero-grid { grid-template-columns: 1fr !important; }
          .cat-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .cat-bento-grid { grid-template-columns: 1fr !important; }
          .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-cta { grid-column: span 1 !important; }
          .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; }
          .cat-bento-grid > div { grid-column: span 1 !important; }
          .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      @media (min-width: 769px) and (max-width: 1024px) {
          .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .cat-bento-hero-1, .cat-bento-hero-3 { grid-column: span 6 !important; }
          .cat-bento-hero-2, .cat-bento-cta { grid-column: span 6 !important; }
          .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-cta) { grid-column: span 3 !important; }
        }
      `}</style>
    </div>
  );
}

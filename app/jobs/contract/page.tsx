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

const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export const revalidate = 3600;

interface EmployerGroupResult { employer: string; _count: { employer: number }; }
interface ProcessedEmployer { name: string; count: number; }

const CT_FILTER = buildCategoryWhereClause('contract');

async function getJobs(skip = 0, take = 20) {
  return prisma.job.findMany({ where: CT_FILTER, orderBy: BEST_SORT_ORDER_BY, skip, take });
}

async function getStats() {
  const totalJobs = await prisma.job.count({ where: CT_FILTER });
  const salaryData = await prisma.job.aggregate({ where: { ...CT_FILTER, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } }, _avg: { normalizedMinSalary: true, normalizedMaxSalary: true } });
  const avgSalary = Math.round(((salaryData._avg.normalizedMinSalary || 0) + (salaryData._avg.normalizedMaxSalary || 0)) / 2 / 1000);
  const topEmployers = await prisma.job.groupBy({ by: ['employer'], where: CT_FILTER, _count: { employer: true }, orderBy: { _count: { employer: 'desc' } }, take: 8 });
  return { totalJobs, avgSalary, topEmployers: topEmployers.map((e: EmployerGroupResult) => ({ name: e.employer, count: e._count.employer })) };
}

const contractFaqs = [
  { question: `What is a Contract ${brand.niche.short} role?`, answer: `Contract ${brand.niche.short} positions are fixed-term assignments (3-12 months) with staffing agencies or health systems. They offer higher hourly rates, diverse clinical exposure, and geographic flexibility.` },
  { question: `How much more do contract ${brand.niche.short}s earn?`, answer: `Contract ${brand.niche.short}s usually earn a higher hourly rate than comparable permanent staff, because benefits are lighter or absent. W-2 contracts through agencies may include benefits; 1099 contracts trade benefits for maximum flexibility and tax deductions.` },
  { question: 'What qualifications are needed for contract work?', answer: 'An active APRN license, national NP certification in your specialty, DEA registration where prescribing is required, and typically 1-2 years of clinical experience. Multi-state licensure is a major advantage.' },
  { question: `Do contract ${brand.niche.short}s get benefits?`, answer: 'W-2 contracts through staffing agencies often include health insurance, malpractice coverage, housing stipends, and travel reimbursement. 1099 contractors arrange their own benefits.' },
  { question: 'Can contract roles convert to permanent?', answer: 'Yes — many facilities use contract-to-perm arrangements. This lets both parties evaluate fit before committing to a permanent position, reducing hiring risk.' },
];

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [stats, params] = await Promise.all([getStats(), searchParams]);
  const page = Math.max(1, parseInt(params.page || '1'));
  return {
    title: `${stats.totalJobs} Contract ${brand.niche.short} Jobs — Fixed-Term Roles`,
    description: `Find ${stats.totalJobs} contract ${brand.niche.short} jobs. Fixed-term ${brand.niche.descriptor} positions with premium rates, diverse settings, and contract-to-perm potential.`,
    alternates: { canonical: `${brand.baseUrl}/jobs/contract` },
    ...(page > 1 && { robots: { index: false, follow: true } }),
  };
}

interface PageProps { searchParams: Promise<{ page?: string }>; }

export default async function ContractPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1'));
  const limit = 10;
  const skip = (page - 1) * limit;
  const [jobs, stats] = await Promise.all([getJobs(skip, limit), getStats()]);

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Jobs", url: `${brand.baseUrl}/jobs` },
        { name: "Contract", url: `${brand.baseUrl}/jobs/contract` }
      ]} />
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName="Contract Jobs" />
      {jobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: `Contract ${brand.niche.short} Jobs`, numberOfItems: stats.totalJobs, itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({ '@type': 'ListItem', position: idx + 1, name: job.title, url: `${brand.baseUrl}/jobs/${job.slug || job.id}` })) }) }} />
      )}

      {/* ═══ HERO ═══ */}
      <CategoryHero
        bgColor="#adc2d7"
        heroImage={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_contract.webp`}
        heroAlt={`Contract ${brand.niche.short} signing agreement`}
        badgeText={`${stats.totalJobs} live roles · updated today`}
        breadcrumbs={['Careers', 'Nurse Practitioner', 'Contract']}
        indexLabel={`№ ${String(ALL_CATEGORY_SLUGS.indexOf('contract') + 1).padStart(2, '0')} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="Contract"
        headlineLine2={brand.niche.short}
        headlineSub="jobs, fixed-term roles."
        stats={[
          { value: `${stats.totalJobs}+`, label: 'positions' },
          { value: stats.avgSalary > 0 ? `$${stats.avgSalary}k` : '$110K+', label: 'avg salary' },
          { value: `${stats.topEmployers.length}+`, label: 'employers' },
        ]}
        description="Fixed-term assignments with premium rates, diverse settings, and geographic flexibility."
        ctaLabel="Browse Contract Jobs"
        ctaHref="/jobs?category=contract"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* ═══ JOB LISTINGS ═══ */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>Contract Positions ({stats.totalJobs})</h2>
            {jobs.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}
              </div>
            ) : (
              <div className="text-center py-12"><p style={{ color: '#7A6A62' }}>No positions right now. Check back soon.</p></div>
            )}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <Link href="/jobs?category=contract" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>Browse All Contract Jobs <ArrowRight size={16} /></Link>
            </div>
          </div>
          <div className="lg:col-span-1">
            <div style={{ ...clayCard, padding: '24px', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
              <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Contract Alerts</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px' }}>New listings delivered daily.</p>
              <Link href="/job-alerts" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link>
            </div>
            {stats.topEmployers.length > 0 && (
              <div style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <Building2 size={20} style={{ color: '#BE185D', marginBottom: '8px' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>Top Employers</h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stats.topEmployers.map((employer: ProcessedEmployer, index: number) => (
                    <li key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: index < stats.topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                      <span style={{ fontSize: '13px', color: '#5A4A42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{employer.name}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', marginLeft: '8px' }}>{employer.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stats.avgSalary > 0 && (
              <div style={{ ...clayCard, padding: '24px' }}>
                <TrendingUp size={20} style={{ color: '#34D399', marginBottom: '8px' }} />
                <div style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35' }}>${stats.avgSalary}k</div>
                <div style={{ fontSize: '13px', color: '#7A6A62' }}>Average salary</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ BENTO ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose Contract</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '48px' }}>Built for Flexibility</h2>
          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1 */}
            <div className="cat-bento-hero-1" style={{ ...clayCard, gridColumn: 'span 8', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' }}>
              <div>
                <h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Contract Assignments</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>Sign 3-12 month contracts with premium rates, then choose your next adventure. Build a diverse clinical portfolio.</p>
              </div>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_signing.webp`} alt="Contract signing" width={280} height={200} style={{ width: '100%', height: 'auto', borderRadius: '14px' }} />
            </div>
            <div className="cat-bento-hero-2" style={{ ...clayCard, gridColumn: 'span 4', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_flexibility.webp`} alt="Contract flexibility" width={200} height={140} style={{ width: '100%', maxWidth: '180px', height: 'auto', borderRadius: '12px', marginBottom: '16px' }} />
              <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Total Flexibility</h3>
              <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Choose your duration, location, and schedule between assignments.</p>
            </div>
            {/* ROW 2: Icon Cards */}
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_terms.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Flexible Terms</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Choose 3-12 month contract durations that fit your life.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_rates.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Higher Rates</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Contract {brand.niche.short}s typically earn more per hour than permanent staff.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_settings.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Diverse Settings</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Experience different clinical environments and patient populations.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_convert.webp`} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Temp-to-Perm</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Many contracts convert to permanent positions if you find the right fit.</p>
            </div>
            {/* ROW 3 */}
            <div className="cat-bento-hero-3" style={{ ...clayCard, gridColumn: 'span 8', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' }}>
              <div>
                <TrendingUp size={28} style={{ color: '#34D399', marginBottom: '12px' }} />
                <h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Premium Rates</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '0 0 6px' }}>Average contract {brand.niche.short} salary:</p>
                <p style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>${stats.avgSalary}k</p>
              </div>
              <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_salary.webp`} alt={`Contract ${brand.niche.short} pay`} width={280} height={200} style={{ width: '100%', height: 'auto', borderRadius: '14px' }} />
            </div>
            <div className="cat-bento-cta" style={{ ...clayCard, gridColumn: 'span 4', padding: '28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
              <Bell size={32} style={{ color: '#BE185D', marginBottom: '14px' }} />
              <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 10px' }}>Get Contract Alerts</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', lineHeight: 1.6, margin: '0 0 20px' }}>New contract positions delivered daily.</p>
              <Link href="/job-alerts" className="cat-cta-primary" style={{ padding: '12px 28px', borderRadius: '12px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 10px rgba(190,24,93,0.2)' }}>Create Alert</Link>
            </div>
          </div>
        </section>
      </div>

      {/* ═══ BEFORE YOU APPLY ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>What You Need</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[
              { num: '01', title: 'NP Certification', desc: 'Active national NP certification in your specialty.' },
              { num: '02', title: 'State License', desc: 'APRN licensure and prescriptive authority.' },
              { num: '03', title: 'DEA Number', desc: 'DEA registration if your role involves prescribing controlled substances.' },
              { num: '04', title: 'Experience', desc: `Clinical experience in ${brand.niche.adjective} settings.` },
            ].map(item => (
              <div key={item.num} className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3' }}>{item.num}</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginTop: '12px', marginBottom: '8px' }}>{item.title}</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ EXPLORE MORE ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Categories</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
              { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
              { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Travel assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` },
              { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
              { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
              { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
            ].map(c => (
              <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center' }}>
                <Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* By Location — pseoStats-gated internal links */}
      <CategoryLocationsExplore categorySlug="contract" categoryLabel="Contract" />

      {/* ═══ FAQ ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Contract {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>
            {contractFaqs.map((faq, idx) => (
              <div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.question}</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
              </div>
            ))}
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: contractFaqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }) }} />
        </section>
      </div>

      {/* ═══ RESPONSIVE CSS ═══ */}
      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .cat-stat-pill { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .cat-stat-pill:hover { transform: translateY(-2px) scale(1.02); box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important; }
        @media (max-width: 768px) {
          .cat-hero-grid { grid-template-columns: 1fr !important; }
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

import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import FAQAccordion from '@/components/FAQAccordion';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import { Mail, HelpCircle } from 'lucide-react';
import { config } from '@/lib/config';

const STORAGE_BASE = brand.assets.storageBase;

const FAQ_OG_IMAGE = `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-hiring-frequently-asked-questions.webp`;

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template so we don't end up
  // with "FAQ | PMHNP Jobs | PMHNP Hiring" (the brand-confusing form
  // audit 09 M-18 flagged — "PMHNP Jobs" is not the brand name).
  title: { absolute: `${brand.name} FAQ — Job Search, Posting & Alerts` },
  description: `Frequently asked questions about ${brand.name}. Learn how to search jobs, post positions, set up alerts, and make the most of the #1 ${brand.niche.short} job board.`,
  openGraph: {
    title: `${brand.name} FAQ`,
    description: `Common questions about searching, posting, and managing ${brand.niche.short} jobs.`,
    type: 'website',
    url: `${brand.baseUrl}/faq`,
    siteName: brand.name,
    images: [{ url: FAQ_OG_IMAGE, width: 1280, height: 900, alt: `${brand.name} FAQ — job posting, salary transparency, job alerts, employer features` }],
  },
  twitter: { card: 'summary_large_image', title: `${brand.name} FAQ`, images: [FAQ_OG_IMAGE] },
  alternates: {
    canonical: `${brand.baseUrl}/faq`,
  },
};

export default function FAQPage() {
  const jobSeekerFaqs = [
    {
      question: `Is ${brand.name} free to use?`,
      answer: "Yes! Job seekers can browse, save, and apply to jobs completely free. There are no hidden fees, subscriptions, or charges for candidates."
    },
    {
      question: "How do I save jobs?",
      answer: "Click the bookmark icon on any job card or detail page. Saved jobs are stored in your browser and accessible anytime from the 'Saved Jobs' page in the navigation menu."
    },
    {
      question: "How do job alerts work?",
      answer: "Create an alert with your search criteria (location, job type, salary, etc.). We'll email you when new matching jobs are posted. You can manage or unsubscribe from alerts at any time."
    },
    {
      question: "Where do the jobs come from?",
      answer: `We aggregate jobs from multiple sources including job boards, company career pages, and direct employer postings. This gives you access to the most comprehensive collection of ${brand.niche.short} opportunities in one place.`
    },
    {
      question: "How do I apply to a job?",
      answer: "Click 'Apply Now' on any job listing. You'll be directed to the employer's application page where you can submit your resume and information directly to them."
    },
    {
      question: "Can I track my applications?",
      answer: "Yes! When you apply to a job and confirm that you've completed the application, the job is automatically tracked in your 'Applications' tab on the Saved Jobs page."
    },
  ];

  const employerFaqs = [
    {
      question: "How much does it cost to post a job?",
      answer: `Your first job post is completely FREE with all features included — no credit card required. After that, each additional post costs $${config.postingPrice} flat. Renewals are discounted at $${config.renewalPrice} (${Math.round((1 - config.renewalPrice / config.postingPrice) * 100)}% off).`
    },
    {
      question: "What features are included?",
      answer: `Every job post — free or paid — gets the same features: Featured badge, top placement in search results, company logo, full analytics with salary benchmarks, ${config.limits.candidateUnlocksPerPosting} candidate profile views, ${config.limits.inmailsPerPosting} InMails, up to 5 screening questions, and apply-on-platform. The only difference is listing duration: free posts run ${config.freeDurationDays} days, paid posts run ${config.durationDays} days.`
    },
    {
      question: "How long do job postings last?",
      answer: `Paid postings are active for ${config.durationDays} days; free postings run for ${config.freeDurationDays} days. Paid postings can be renewed any time from the employer dashboard for $${config.renewalPrice} (${Math.round((1 - config.renewalPrice / config.postingPrice) * 100)}% off the regular price). Free postings cannot be renewed at the discounted rate — post a fresh listing at $${config.postingPrice} instead.`
    },
    {
      question: "If I renew before my post expires, do I lose the remaining days?",
      answer: `No. Renewing early adds ${config.durationDays} days to your current expiration date — you keep every day you've already paid for. Renew on your schedule.`
    },
    {
      question: "What happens to candidates I've unlocked when my posting expires?",
      answer: "You keep them. Once you've unlocked a candidate (paid 1 of your 25 unlocks to view their full profile), their contact info, resume, and details remain accessible in your dashboard forever — even after the posting expires. To unlock new candidates or send new InMails, you'll need an active posting."
    },
    {
      question: "Can I edit my job posting?",
      answer: "Yes! Open your employer dashboard (link is in your confirmation email) and click Edit on any posting. You can update salary, requirements, description, or any other details — changes go live immediately."
    },
    {
      question: "How do I access my employer dashboard?",
      answer: `Check your confirmation email for a dashboard link. The dashboard allows you to view analytics, edit your posting, browse candidates, and manage all your job postings in one place. If you've lost the link, contact us at ${brand.email.support}.`
    },
    {
      question: "Do you offer refunds?",
      answer: `Contact us at ${brand.email.support} within 7 days of posting if you're unsatisfied and we'll work with you. We want you to have a great experience and will do our best to resolve any issues.`
    },
  ];

  const generalFaqs = [
    {
      question: "How do I contact support?",
      answer: `Email us at ${brand.email.support} and we'll respond within 24 hours (usually much faster). You can also use our contact form for general inquiries.`
    },
    {
      question: "Is my information secure?",
      answer: "Yes. We use industry-standard security practices including encrypted connections (HTTPS), secure payment processing through Stripe, and we never share your personal information with third parties. See our Privacy Policy for complete details."
    },
    {
      question: "How often are jobs updated?",
      answer: "Jobs are added and updated daily. New postings go live immediately, and we regularly refresh aggregated listings to ensure accuracy."
    },
    {
      question: "Can I post jobs in multiple locations?",
      answer: "Yes! When creating your job posting, you can specify multiple locations or select 'Remote' for positions that can be done from anywhere."
    },
  ];

  const careerFaqs = [
    {
      question: `How long does it take to become a ${brand.niche.descriptor}?`,
      answer: `Becoming an ${brand.niche.short} typically takes 6-8 years: 4 years for a BSN, 1-2 years of RN experience, and 2-3 years for an MSN or DNP with ${brand.niche.short} specialization. Accelerated BSN-to-DNP programs can shorten this timeline.`
    },
    {
      question: `What educational background is required for an ${brand.niche.short} role?`,
      answer: `You need a Bachelor of Science in Nursing (BSN), then a Master's (MSN) or Doctoral (DNP) degree from a CCNE or ACEN accredited ${brand.niche.short} program. You must also pass a national ${brand.niche.short} board certification exam through ANCC or AANP.`
    },
    {
      question: `What is the difference between an ${brand.niche.short} and a physician?`,
      answer: `${brand.niche.short}s hold a Master's or Doctoral degree in nursing (2-4 years of graduate school), while physicians complete medical school plus a 3-7 year residency. Both can diagnose, treat, and prescribe. In full practice authority states, ${brand.niche.short}s practice independently. ${brand.niche.short}s reach full practice faster and with far less educational debt, while physicians train for a broader, more specialized scope.`
    },
    {
      question: `What are the main ${brand.niche.short} specialties?`,
      answer: `The largest ${brand.niche.short} specialty is family practice (FNP), followed by adult-gerontology (AGNP, in primary-care and acute-care tracks), psychiatric-mental health (PMHNP), pediatrics (PNP), women's health (WHNP), and neonatal (NNP). Each has its own national board certification and population focus, and most job postings list the certification they require.`
    },
    {
      question: `Can I complete an ${brand.niche.short} program online?`,
      answer: `Yes, many accredited universities offer online ${brand.niche.short} programs. Didactic coursework is completed online, but you'll still need to complete 500+ clinical hours in person at approved sites. Top online programs include Vanderbilt, Rush, and University of Cincinnati.`
    },
    {
      question: `What is the ROI of an ${brand.niche.short} degree?`,
      answer: `The ROI is excellent. Graduate school costs $35,000-$80,000 for an MSN. ${brand.niche.short}s earn a median of about $126,000 — roughly $40,000 more per year than the average RN. Most ${brand.niche.short}s pay off their graduate degree investment within 2-4 years of working.`
    },
    {
      question: `What are the top 3 ${brand.niche.short} jobs for new grads?`,
      answer: `1) Federally Qualified Health Centers (FQHCs) — structured settings with mentorship, often qualifying for HRSA loan repayment. 2) Outpatient group practices — collaborative environments with gradual caseload ramp-up. 3) VA ${brand.niche.short} positions — federal benefits, pension, and residency programs for new graduates.`
    },
  ];

  const salaryFaqs = [
    {
      question: `What is the average salary of a ${brand.niche.descriptor} in the United States?`,
      answer: `The average ${brand.niche.short} salary in 2026 is about $126,000-$135,000 per year. New graduates typically start at $95,000-$115,000, while experienced ${brand.niche.short}s in high-demand specialties and settings earn $150,000-$180,000+. Private practice owners and locum tenens providers can earn more depending on volume and overhead.`
    },
    {
      question: `Which states pay the highest salaries for ${brand.niche.short}s?`,
      answer: `${brand.niche.short} pay is consistently highest in West Coast and Northeast markets — California, Washington, Oregon, Nevada, and New Jersey rank near the top in federal wage data. When adjusted for cost of living, several Midwest and Southern states offer stronger real purchasing power. See our salary guide for state-by-state figures.`
    },
    {
      question: `How do ${brand.niche.descriptor} salaries vary by specialty?`,
      answer: `Compensation varies meaningfully by specialty. Acute care, psychiatric-mental health, and emergency ${brand.niche.short}s typically sit at the higher end — often 10-20% above the national median — while family practice and primary-care roles cluster near it. Setting matters as much as specialty: hospital, VA, and correctional roles usually out-pay clinic positions, and Full Practice Authority states tend to carry a premium.`
    },
    {
      question: `Does having a DNP vs MSN affect an ${brand.niche.short}'s salary?`,
      answer: `In clinical roles, DNP and MSN ${brand.niche.short}s typically earn similar salaries — the degree itself rarely commands a higher clinical wage. However, DNP holders have advantages in academic positions, executive leadership roles, and may qualify for higher-tier positions in hospital systems.`
    },
    {
      question: `How can you make the most money as an ${brand.niche.short}?`,
      answer: "Top strategies include: owning a private practice ($200K-$300K+), specializing in high-demand areas like acute, emergency, or correctional care, practicing in Full Practice Authority states (+12-15% premium), working locum tenens ($150K-$250K), and always negotiating total compensation."
    },
    {
      question: `What is the salary range for locum tenens ${brand.niche.short} jobs?`,
      answer: `Locum tenens ${brand.niche.short}s earn $150,000-$250,000+ annually, with hourly rates of $85-$150+. This includes housing stipends, travel allowances, and malpractice coverage. Locum tenens pay rates are typically 20-50% higher than permanent positions, making it one of the highest-earning ${brand.niche.short} career paths.`
    },
  ];

  const scopeFaqs = [
    {
      question: `What is the scope of practice for an ${brand.niche.short}?`,
      answer: `An ${brand.niche.short}'s scope of practice includes assessing and diagnosing acute and chronic conditions, prescribing medications including controlled substances, ordering and interpreting diagnostic tests, performing procedures within their specialty training, providing patient education and counseling, and managing treatment plans. The specific scope varies by state practice authority laws.`
    },
    {
      question: `What are the certification requirements for ${brand.niche.short} graduates?`,
      answer: `After graduating from an accredited ${brand.niche.short} program, you must pass a national board certification exam for your population focus (ANCC or AANP, roughly $315-$395), apply for state APRN licensure, obtain an NPI number, register with the DEA for prescriptive authority ($888/3 years), and create a CAQH ProView profile for insurance credentialing. Board certification typically renews every 5 years with continuing-education requirements.`
    },
    {
      question: `What extra certifications can an ${brand.niche.short} get?`,
      answer: `${brand.niche.short}s can pursue additional credentials in areas like emergency care (ENP-C), diabetes education (CDCES), dermatology (DCNP), oncology (AOCNP), and pain management or aesthetics training. These added specializations often command salary premiums and open doors to niche roles.`
    },
    {
      question: `Are there state licensure rules that affect demand for ${brand.niche.short}s?`,
      answer: `Yes. States with Full Practice Authority (34 states + DC) allow ${brand.niche.short}s to practice independently, driving higher demand and salaries. Reduced and restricted practice states require physician collaboration or supervision, which can limit the number of available positions and affect compensation.`
    },
    {
      question: `What skills are employers seeking in ${brand.niche.short} graduates?`,
      answer: "Top skills employers seek include strong clinical assessment and diagnostic skills, confident prescribing and medication management, Epic/Cerner EHR proficiency, chronic-disease management, patient education and counseling, cultural competence, telehealth platform experience, and experience with diverse populations including pediatric, geriatric, and veteran patients."
    },
    {
      question: `What negotiation strategies can enhance salary offers for ${brand.niche.short}s?`,
      answer: `Key strategies include researching market rates by state and setting, negotiating total compensation (not just base salary), asking for sign-on bonuses ($5,000-$30,000), requesting CME allowance ($2,000-$5,000/year), student loan repayment assistance, additional PTO, and flexible scheduling. ${brand.niche.short}s who negotiate typically secure 5-15% higher starting salaries.`
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <VideoJsonLd pathname="/faq" />
      <BreadcrumbSchema items={[
        { name: 'Home', url: brand.baseUrl },
        { name: 'FAQ', url: `${brand.baseUrl}/faq` },
      ]} />
      {/* FAQPage Schema for Google rich results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [...jobSeekerFaqs, ...employerFaqs, ...careerFaqs, ...salaryFaqs, ...scopeFaqs, ...generalFaqs].map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
              },
            })),
          }),
        }}
      />
      {/* Hero Section */}
      <section style={{ padding: '80px 16px 64px', maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '32px', alignItems: 'center' }} className="faq-hero-grid">
              <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: '#FFF1F2', color: '#E11D48', borderRadius: '20px', fontSize: '13px', fontWeight: 700, marginBottom: '24px' }}>
                      <HelpCircle size={14} /> Knowledge Base
                  </div>
                  <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', fontWeight: 800, fontFamily: 'var(--font-lora), Georgia, serif', color: '#1A2E35', marginBottom: '16px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                      Frequently Asked <span style={{ color: '#E11D48' }}>Questions</span>
                  </h1>
                  <p style={{ fontSize: '20px', color: '#6B7F8A', lineHeight: 1.6, margin: 0, maxWidth: '500px' }}>
                      Find answers to common questions about {brand.name}, platform features, salary benchmarks, and clinical credentials.
                  </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/clay_hero_faq.webp`} alt={`FAQ ${brand.niche.short} Jobs`} width={280} height={280} style={{ objectFit: 'contain', filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.15))' }} priority />
              </div>
          </div>
      </section>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* For Job Seekers FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              For Job Seekers
            </h2>
            <FAQAccordion items={jobSeekerFaqs} />
          </Card>
        </section>

        {/* For Employers FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              For Employers
            </h2>
            <FAQAccordion items={employerFaqs} />
          </Card>
        </section>

        {/* PMHNP Career & Education FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              {brand.niche.short} Career &amp; Education
            </h2>
            <FAQAccordion items={careerFaqs} />
          </Card>
        </section>

        {/* Salary & Compensation FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              Salary &amp; Compensation
            </h2>
            <FAQAccordion items={salaryFaqs} />
          </Card>
        </section>

        {/* Scope of Practice & Credentials FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              Scope of Practice &amp; Credentials
            </h2>
            <FAQAccordion items={scopeFaqs} />
          </Card>
        </section>

        {/* General FAQ */}
        <section className="mb-12">
          <Card padding="lg" variant="elevated">
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
              General Questions
            </h2>
            <FAQAccordion items={generalFaqs} />
          </Card>
        </section>

        {/* Still Have Questions Section */}
        <section>
          <Card padding="lg" variant="bordered" className="text-center">
            <Mail className="w-12 h-12 text-pink-700 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Still Have Questions?
            </h2>
            <p className="mb-6 max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Didn&apos;t find your answer? We&apos;re here to help. Reach out and we&apos;ll get back to you within 24 hours.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-lg mx-auto">
              <a href={`mailto:${brand.email.support}`} className="w-full sm:w-auto">
                <Button variant="primary" size="lg" className="w-full">
                  <Mail size={20} />
                  Email Us
                </Button>
              </a>
              <Link href="/contact" className="w-full sm:w-auto">
                <Button variant="outline" size="lg" className="w-full">
                  Contact Us
                </Button>
              </Link>
            </div>
          </Card>
        </section>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
          @media (max-width: 768px) {
              .faq-hero-grid { grid-template-columns: 1fr !important; text-align: center; }
              .faq-hero-grid > div:last-child { order: -1; }
              .faq-hero-grid > div:first-child p { margin-left: auto; margin-right: auto; }
          }
      ` }} />
    </div>
  );
}


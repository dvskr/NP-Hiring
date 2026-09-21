import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import FAQAccordion from '@/components/FAQAccordion';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import { Mail, HelpCircle } from 'lucide-react';
import { config } from '@/lib/config';
import { STAT_SOURCES } from '@/lib/stats-sources';

// Edge-generated OG card — no dependency on storage assets that don't
// exist on this board (the old pmhnp-*.webp URL 400s). Same pattern as
// app/for-employers/page.tsx.
const FAQ_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.name} FAQ`)}&type=page`;

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template so we don't end up
  // with "FAQ | PMHNP Jobs | PMHNP Hiring" (the brand-confusing form
  // audit 09 M-18 flagged — "PMHNP Jobs" is not the brand name).
  title: { absolute: `${brand.name} FAQ | Job Search, Posting & Alerts` },
  description: `Frequently asked questions about ${brand.name}. Learn how to search jobs, post positions, set up alerts, and make the most of the #1 ${brand.niche.short} job board.`,
  openGraph: {
    title: `${brand.name} FAQ`,
    description: `Common questions about searching, posting, and managing ${brand.niche.short} jobs.`,
    type: 'website',
    url: `${brand.baseUrl}/faq`,
    siteName: brand.name,
    images: [{ url: FAQ_OG_IMAGE, width: 1200, height: 630, alt: `${brand.name} FAQ: job posting, salary transparency, job alerts, and employer features` }],
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

  // Pricing answers are written around the launch promo + 2027 ladder in
  // lib/config — every number and date is a config token, and the sentences
  // match the canonical copy on /pricing so the FAQPage JSON-LD below never
  // tells Google a different price than the pricing page does.
  const employerFaqs = [
    {
      question: "How much does it cost to post a job?",
      answer: `Free through ${config.promoEndsLabel}. Every job post is free during our launch period: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required. From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`
    },
    {
      question: "What features are included?",
      answer: `Every job post, whether free during the promo, intro, featured, or posted from an Employer plan slot, gets the same features: a ${config.durationDays}-day listing, Featured badge, top placement in search results, company logo, full analytics with salary benchmarks, ${config.limits.candidateUnlocksPerPosting} candidate profile views, ${config.limits.inmailsPerPosting} InMails, up to 5 screening questions, and apply-on-platform. There is no stripped-down tier.`
    },
    {
      question: `What is the intro price, and who gets it?`,
      answer: `From ${config.ladderStartsLabel}, the first paid post per company email domain is $${config.introPrice} instead of $${config.postingPrice}. It is scoped to your organization's domain, not to a login, and posts made free during the launch promo do not use it up.`
    },
    {
      question: "How does the Employer plan work?",
      answer: `$${config.planPrice}/month. ${config.planSlots} active job slots, live while you're subscribed. Swap jobs any time. Cancel any time. The plan is billed month to month from ${config.ladderStartsLabel}; if you cancel, your posts stay live through the end of the paid period. Every slot is a full Featured post with the same ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails.`
    },
    {
      question: "How long do job postings last, and what does renewal cost?",
      answer: `Every posting is active for ${config.durationDays} days. Renew any post for $${config.renewalPrice} (+${config.durationDays} days) from the employer dashboard, promo posts included. Plan posts stay live while your plan is active, so they don't need renewing.`
    },
    {
      question: "If I renew before my post expires, do I lose the remaining days?",
      answer: `No. Renewing early adds ${config.durationDays} days to your current expiration date, so you keep every day you already have. Renew on your schedule.`
    },
    {
      question: "What happens to candidates I've unlocked when my posting expires?",
      answer: "You keep them. Once you've unlocked a candidate (paid 1 of your 25 unlocks to view their full profile), their contact info, resume, and details remain accessible in your dashboard forever, even after the posting expires. To unlock new candidates or send new InMails, you'll need an active posting."
    },
    {
      question: "Can I edit my job posting?",
      answer: "Yes! Open your employer dashboard (link is in your confirmation email) and click Edit on any posting. You can update the salary, requirements, description, or any other details, and changes go live immediately."
    },
    {
      question: "How do I access my employer dashboard?",
      answer: `Check your confirmation email for a dashboard link. The dashboard allows you to view analytics, edit your posting, browse candidates, and manage all your job postings in one place. If you've lost the link, contact us at ${brand.email.support}.`
    },
    {
      question: "Do you offer refunds?",
      answer: `Posting fees are generally non-refundable, but if you're unsatisfied, email ${brand.email.support} within 7 days of purchase with your order details and we'll review the request case by case. Promo posts involve no payment to refund, and Employer plan months already billed are not refunded. Cancelling stops future renewals, and your posts stay live through the end of the paid period.`
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
      answer: `Becoming an ${brand.niche.short} typically takes 6 to 8 years: 4 years for a BSN, 1 to 2 years of RN experience, and 2 to 3 years for an MSN or DNP with ${brand.niche.short} specialization. Accelerated BSN-to-DNP programs can shorten this timeline.`
    },
    {
      question: `What educational background is required for an ${brand.niche.short} role?`,
      answer: `You need a Bachelor of Science in Nursing (BSN), then a Master's (MSN) or Doctoral (DNP) degree from a CCNE or ACEN accredited ${brand.niche.short} program. You must also pass a national ${brand.niche.short} board certification exam through ANCC or AANP.`
    },
    {
      question: `What is the difference between an ${brand.niche.short} and a physician?`,
      answer: `${brand.niche.short}s hold a Master's or Doctoral degree in nursing (2 to 4 years of graduate school), while physicians complete medical school plus a residency of 3 to 7 years. Both can diagnose, treat, and prescribe. In full practice authority states, ${brand.niche.short}s practice independently. ${brand.niche.short}s reach full practice faster and with far less educational debt, while physicians train for a broader, more specialized scope.`
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
      answer: `The ROI is excellent. Graduate school costs vary by program, and ${brand.niche.short}s earn a median of ${STAT_SOURCES.averageSalary.formatted} per year (${STAT_SOURCES.averageSalary.source}, ${STAT_SOURCES.averageSalary.asOf}), which is well above the median RN salary, so most ${brand.niche.short}s recoup their graduate-degree investment within a few years of full-time practice.`
    },
    {
      question: `What are the top 3 ${brand.niche.short} jobs for new grads?`,
      answer: `1) Federally Qualified Health Centers (FQHCs): structured settings with mentorship that often qualify for HRSA loan repayment. 2) Outpatient group practices: collaborative environments with a gradual caseload ramp-up. 3) VA ${brand.niche.short} positions: federal benefits, a pension, and residency programs for new graduates.`
    },
  ];

  const salaryFaqs = [
    {
      question: `What is the average salary of a ${brand.niche.descriptor} in the United States?`,
      answer: `${brand.niche.short}s earn a median annual salary of ${STAT_SOURCES.averageSalary.formatted} based on the ${STAT_SOURCES.averageSalary.source} (${STAT_SOURCES.averageSalary.asOf}). Salaries range from roughly $120,000 for new graduates to $200,000+ for experienced ${brand.niche.short}s in high-demand specialties and settings. Private practice owners and locum tenens providers can earn more depending on volume and overhead.`
    },
    {
      question: `Which states pay the highest salaries for ${brand.niche.short}s?`,
      answer: `${brand.niche.short} pay is consistently highest in West Coast and Northeast markets: California, Washington, Oregon, Nevada, and New Jersey rank near the top in federal wage data. When adjusted for cost of living, several Midwest and Southern states offer stronger real purchasing power. See our salary guide for state-by-state figures.`
    },
    {
      question: `How do ${brand.niche.descriptor} salaries vary by specialty?`,
      answer: `Compensation varies meaningfully by specialty. Acute care, psychiatric-mental health, and emergency ${brand.niche.short}s typically sit at the higher end of the range, while family practice and primary-care roles cluster near the national median. Setting matters as much as specialty: hospital, VA, and correctional roles usually out-pay clinic positions, and Full Practice Authority states tend to carry a premium.`
    },
    {
      question: `Does having a DNP vs MSN affect an ${brand.niche.short}'s salary?`,
      answer: `In clinical roles, DNP and MSN ${brand.niche.short}s typically earn similar salaries; the degree itself rarely commands a higher clinical wage. However, DNP holders have advantages in academic positions and executive leadership roles, and they may qualify for higher-tier positions in hospital systems.`
    },
    {
      question: `How can you make the most money as an ${brand.niche.short}?`,
      answer: "Top strategies include: owning a private practice, specializing in high-demand areas like acute, emergency, or correctional care, practicing in Full Practice Authority states, working locum tenens, and always negotiating total compensation rather than base salary alone."
    },
    {
      question: `What is the salary range for locum tenens ${brand.niche.short} jobs?`,
      answer: `Locum tenens ${brand.niche.short}s are typically paid hourly, commonly in the $60 to $150+ per hour range depending on specialty and setting, with CRNA locum rates at the top of the market. Packages usually include housing stipends, travel allowances, and malpractice coverage, and locum rates typically run higher than comparable permanent positions, which makes it one of the higher-earning ${brand.niche.short} career paths.`
    },
  ];

  const scopeFaqs = [
    {
      question: `What is the scope of practice for an ${brand.niche.short}?`,
      answer: `An ${brand.niche.short}'s scope of practice includes assessing and diagnosing acute and chronic conditions, prescribing medications including controlled substances, ordering and interpreting diagnostic tests, performing procedures within their specialty training, providing patient education and counseling, and managing treatment plans. The specific scope varies by state practice authority laws.`
    },
    {
      question: `What are the certification requirements for ${brand.niche.short} graduates?`,
      answer: `After graduating from an accredited ${brand.niche.short} program, you must pass a national board certification exam for your population focus (ANCC or AANP), apply for state APRN licensure, obtain an NPI number, register with the DEA for prescriptive authority, and create a CAQH ProView profile for insurance credentialing. Board certification typically renews every 5 years with continuing-education requirements.`
    },
    {
      question: `What extra certifications can an ${brand.niche.short} get?`,
      answer: `${brand.niche.short}s can pursue additional credentials in areas like emergency care (ENP-C), diabetes education (CDCES), dermatology (DCNP), oncology (AOCNP), and pain management or aesthetics training. These added specializations often command salary premiums and open doors to niche roles.`
    },
    {
      question: `Are there state licensure rules that affect demand for ${brand.niche.short}s?`,
      answer: `Yes. States with Full Practice Authority (${STAT_SOURCES.fullPracticeStates.formatted} per the ${STAT_SOURCES.fullPracticeStates.source}, ${STAT_SOURCES.fullPracticeStates.asOf}) allow ${brand.niche.short}s to practice independently, driving higher demand and salaries. Reduced and restricted practice states require physician collaboration or supervision, which can limit the number of available positions and affect compensation.`
    },
    {
      question: `What skills are employers seeking in ${brand.niche.short} graduates?`,
      answer: "Top skills employers seek include strong clinical assessment and diagnostic skills, confident prescribing and medication management, Epic/Cerner EHR proficiency, chronic-disease management, patient education and counseling, cultural competence, telehealth platform experience, and experience with diverse populations including pediatric, geriatric, and veteran patients."
    },
    {
      question: `What negotiation strategies can enhance salary offers for ${brand.niche.short}s?`,
      answer: `Key strategies include researching market rates by state and setting, negotiating total compensation (not just base salary), asking for a sign-on bonus, requesting a CME allowance, student loan repayment assistance, additional PTO, and flexible scheduling. ${brand.niche.short}s who negotiate typically secure meaningfully higher starting offers than those who accept the first number.`
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
                  {/* Exact-DPR ladder (scripts/regen-image-ladders.mjs) — reuses the
                      already-laddered how-it-works illustration so the priority LCP
                      image paints 1:1 physical pixels at every display scale (the
                      old Supabase clay_hero_faq.webp 400s — dead bucket). See
                      components/EmployerHowItWorks.tsx for the pattern. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                      src="/images/how-it-works/step-employer-browse-560.webp"
                      srcSet={[280, 350, 420, 490, 560, 630, 700, 840]
                          .map((w) => `/images/how-it-works/step-employer-browse-${w}.webp ${w}w`)
                          .join(', ')}
                      sizes="280px"
                      alt={`Illustration: browsing ${brand.niche.short} jobs and answers on ${brand.name}`}
                      width={280} height={280}
                      style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '20px', boxShadow: '0 20px 30px rgba(0,0,0,0.15)', display: 'block' }}
                      fetchPriority="high"
                      decoding="async"
                  />
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


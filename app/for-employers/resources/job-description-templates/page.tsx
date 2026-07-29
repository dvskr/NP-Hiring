/**
 * Public JD-template library index (P1 #18).
 *
 * Renders the 12 frozen skeletons from lib/jd-templates.ts (read-only
 * consume) as a browsable, grouped library. Every card links to a full
 * template page; the ItemList JSON-LD derives from the SAME registry the
 * cards render, so schema and visible content cannot diverge. These are
 * the exact templates the post-job wizard's starter panel offers.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';
import {
  JD_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  type JdTemplateCategory,
} from '@/lib/jd-templates';
import { ClipboardList, ArrowRight } from 'lucide-react';

const PAGE_URL = `${brand.baseUrl}/for-employers/resources/job-description-templates`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Job Description Templates`)}&type=page`;

export const metadata: Metadata = {
  title: `${JD_TEMPLATES.length} Free ${brand.niche.short} Job Description Templates by Setting | ${brand.name}`,
  description: `Free ${brand.niche.descriptor} job description templates for every practice setting: outpatient, inpatient, telehealth, urgent care, emergency, community health, and correctional health. Customize and post in minutes.`,
  keywords: [
    `${brand.niche.short} job description template`,
    `${brand.niche.descriptor} job description sample`,
    `${brand.niche.short} job posting template`,
    `hiring ${brand.niche.short}s`,
  ],
  openGraph: {
    title: `${JD_TEMPLATES.length} ${brand.niche.short} Job Description Templates`,
    description: `Setting-specific ${brand.niche.short} job description skeletons — free to browse, customize, and post.`,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} job description templates` }],
  },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
  alternates: { canonical: PAGE_URL },
};

// Escape < and > so serialized content can never terminate the script
// element early (repo pattern: components/BreadcrumbSchema.tsx).
const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function JdTemplateLibraryPage() {
  const categories = (
    Object.keys(TEMPLATE_CATEGORY_LABELS) as JdTemplateCategory[]
  ).map((cat) => ({
    cat,
    label: TEMPLATE_CATEGORY_LABELS[cat],
    templates: JD_TEMPLATES.filter((t) => t.category === cat),
  }));

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* ItemList derives from the SAME JD_TEMPLATES registry the cards render. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: `${brand.niche.short} Job Description Templates`,
            numberOfItems: JD_TEMPLATES.length,
            itemListElement: JD_TEMPLATES.map((t, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: t.label,
              url: `${PAGE_URL}/${t.id}`,
            })),
          }),
        }}
      />

      {/* Hero */}
      <section className="py-12 md:py-16 text-white" style={{ background: 'linear-gradient(135deg, #831843, #BE185D)' }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <ClipboardList className="w-8 h-8" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {brand.niche.short} Job Description Templates
            </h1>
            <p className="text-lg md:text-xl text-pink-100">
              {JD_TEMPLATES.length} setting-specific skeletons — bullet-structured, with bracketed prompts marking every detail to customize. The same starters are built into the post-job form.
            </p>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'For Employers', href: '/for-employers' },
              { label: 'Resources', href: '/for-employers/resources' },
              { label: 'Job Description Templates' },
            ]}
          />

          {/* How the templates work */}
          <div className="mb-10 rounded-xl p-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>How these templates work</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Each skeleton follows the same nine-section structure our{' '}
              <Link href="/for-employers/resources/job-description-guide" className="underline font-medium" style={{ color: 'var(--color-primary)' }}>
                job-description guide
              </Link>{' '}
              recommends. Text in [square brackets] is a prompt for you to replace with your actual specifics — visit lengths, EHR, schedule, salary range. The shared qualification, compensation, and application sections stay consistent across all {JD_TEMPLATES.length} templates so the scope-of-practice language is reviewed once. Inside the post-job form, the same templates fill in your practice name and location from the fields you have already entered.
            </p>
          </div>

          {/* Grouped template cards */}
          {categories.map(({ cat, label, templates }) => (
            <div key={cat} className="mb-10">
              <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>{label}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((t) => (
                  <Link
                    key={t.id}
                    href={`/for-employers/resources/job-description-templates/${t.id}`}
                    className="block rounded-xl p-5 transition-all hover:shadow-md hover:-translate-y-0.5"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                  >
                    <h3 className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{t.label}</h3>
                    <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{t.summary}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-800 font-medium">{t.setting}</span>
                      <span className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{t.population}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* CTA */}
          <div
            className="rounded-xl p-6 md:p-8 text-center"
            style={{ background: 'linear-gradient(135deg, #FDF2F8, #FCE7F3)', border: '1px solid rgba(190,24,93,0.2)' }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: '#831843' }}>
              Use a template in your posting
            </h2>
            <p className="text-sm mb-5 max-w-lg mx-auto" style={{ color: '#9D174D' }}>
              Open the post-job form and pick any of these {JD_TEMPLATES.length} starters from the description editor — your practice name and location fill in automatically. First post free.
            </p>
            <Link
              href="/post-job"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm text-white"
              style={{ background: 'linear-gradient(145deg, #BE185D, #9D174D)' }}
            >
              Post a Job — First Post Free <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Employer content hub — /for-employers/resources (P1 #18).
 *
 * Public hiring-side counterpart to the seeker-only /resources hub:
 * two evergreen hiring guides plus the browsable JD-template library
 * rendered from the frozen lib/jd-templates.ts registry (read-only
 * consume — the same 12 skeletons the post-job wizard's template
 * picker offers).
 *
 * TRUTH RULES: this hub renders no statistics. The guide/library
 * cards and the ItemList JSON-LD derive from the SAME arrays below so
 * schema and visible content cannot diverge (repo pattern:
 * app/for-employers/page.tsx employerFaqs).
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
import { BookOpen, PenLine, ClipboardList, ArrowRight, FileText } from 'lucide-react';

const HUB_URL = `${brand.baseUrl}/for-employers/resources`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Employer Hiring Resources — hire ${brand.niche.short}s`)}&type=page`;

export const metadata: Metadata = {
  title: `Employer Hiring Resources — Guides & ${brand.niche.short} Job Description Templates | ${brand.name}`,
  description: `Free hiring resources for teams recruiting ${brand.niche.descriptor}s: a step-by-step hiring guide, a job-description writing guide, and ${JD_TEMPLATES.length} setting-specific ${brand.niche.short} job description templates.`,
  openGraph: {
    title: `Employer Hiring Resources | ${brand.name}`,
    description: `Hiring guides and ${JD_TEMPLATES.length} ${brand.niche.short} job description templates for employers.`,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${brand.name} employer hiring resources` }],
  },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
  alternates: { canonical: HUB_URL },
};

// Single source of truth for the three hub resources. Feeds BOTH the
// visible cards and the ItemList JSON-LD below.
const HUB_RESOURCES = [
  {
    href: '/for-employers/resources/how-to-hire',
    title: `How to Hire a ${brand.niche.long}`,
    description: `The full hiring process — defining the role, benchmarking pay against live salary data, credential verification, and realistic timeline planning.`,
    icon: BookOpen,
    tag: 'Guide',
  },
  {
    href: '/for-employers/resources/job-description-guide',
    title: `Writing a ${brand.niche.short} Job Description`,
    description: `The anatomy of a job description that qualified ${brand.niche.descriptor}s actually respond to — section by section, with the mistakes to avoid.`,
    icon: PenLine,
    tag: 'Guide',
  },
  {
    href: '/for-employers/resources/job-description-templates',
    title: `${brand.niche.short} Job Description Templates`,
    description: `${JD_TEMPLATES.length} setting-specific skeleton templates — outpatient, inpatient, telehealth, and specialty settings — ready to customize in the post-job form.`,
    icon: ClipboardList,
    tag: 'Template Library',
  },
] as const;

// Escape < and > so serialized content can never terminate the script
// element early (repo pattern: components/BreadcrumbSchema.tsx).
const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function EmployerResourcesHubPage() {
  const categories = (
    Object.keys(TEMPLATE_CATEGORY_LABELS) as JdTemplateCategory[]
  ).map((cat) => ({
    cat,
    label: TEMPLATE_CATEGORY_LABELS[cat],
    templates: JD_TEMPLATES.filter((t) => t.category === cat),
  }));

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* ItemList derives from the SAME HUB_RESOURCES array the cards render. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: `${brand.name} Employer Hiring Resources`,
            itemListElement: HUB_RESOURCES.map((r, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: r.title,
              url: `${brand.baseUrl}${r.href}`,
            })),
          }),
        }}
      />

      {/* Hero */}
      <section className="py-12 md:py-16 text-white" style={{ background: 'linear-gradient(135deg, #831843, #BE185D)' }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <FileText className="w-8 h-8" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Employer Hiring Resources
            </h1>
            <p className="text-lg md:text-xl text-pink-100">
              Everything your team needs to recruit {brand.niche.descriptor}s — hiring guides, salary benchmarking pointers, and {JD_TEMPLATES.length} job-description templates.
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
              { label: 'Resources' },
            ]}
          />

          {/* Guide + library cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            {HUB_RESOURCES.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="block rounded-xl p-6 transition-all hover:shadow-md hover:-translate-y-0.5"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                >
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-pink-800" aria-hidden="true" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-primary)' }}>
                    {r.tag}
                  </p>
                  <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    {r.title}
                  </h2>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {r.description}
                  </p>
                </Link>
              );
            })}
          </div>

          {/* Template library preview — grouped by category, derived from
              the frozen JD_TEMPLATES registry so this list can never drift
              from what the post-job wizard offers. */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Browse the Template Library
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              {JD_TEMPLATES.length} skeleton starters organized by practice setting. Each opens as a full page you can review before posting.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {categories.map(({ cat, label, templates }) => (
                <div
                  key={cat}
                  className="rounded-xl p-5"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                >
                  <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>
                    {label}
                  </h3>
                  <ul className="space-y-2">
                    {templates.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/for-employers/resources/job-description-templates/${t.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t.label}
                        </Link>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{t.summary}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div
            className="rounded-xl p-6 md:p-8 text-center"
            style={{ background: 'linear-gradient(135deg, #FDF2F8, #FCE7F3)', border: '1px solid rgba(190,24,93,0.2)' }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: '#831843' }}>
              Ready to post your {brand.niche.short} role?
            </h2>
            <p className="text-sm mb-5 max-w-lg mx-auto" style={{ color: '#9D174D' }}>
              Your first post is free with every feature included. The same {JD_TEMPLATES.length} templates are available inside the description editor.
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

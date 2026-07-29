/**
 * Public JD-template detail page (P1 #18) — one page per skeleton in the
 * frozen lib/jd-templates.ts registry (read-only consume).
 *
 * The rendered body is renderTemplate(template, {}) — the registry's own
 * neutral-fallback substitution ("Our practice" / "your area" / "your
 * state"), so the public page reads naturally while the [bracketed]
 * customization prompts stay visible. The HTML is repo-authored, frozen
 * at build time, and contains no user input — safe for
 * dangerouslySetInnerHTML.
 *
 * CTA: plain link to /post-job. The wizard's starter panel lists these
 * same templates; its page reads only a `resume` search param today
 * (checked app/post-job/page.tsx), and post-job belongs to another
 * workstream — so no template query param is invented here.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import {
  JD_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  renderTemplate,
  type JdTemplate,
} from '@/lib/jd-templates';
import { ArrowRight, Info } from 'lucide-react';

const LIBRARY_PATH = '/for-employers/resources/job-description-templates';

interface Props {
  params: Promise<{ id: string }>;
}

export function generateStaticParams(): Array<{ id: string }> {
  return JD_TEMPLATES.map((t) => ({ id: t.id }));
}

function findTemplate(id: string): JdTemplate | undefined {
  return JD_TEMPLATES.find((t) => t.id === id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const template = findTemplate(id);
  if (!template) return {};

  const title = `${template.label} — ${brand.niche.short} Job Description Template`;
  const ogImage = `${brand.baseUrl}/api/og?title=${encodeURIComponent(title)}&type=page`;
  return {
    title: `${title} | ${brand.name}`,
    description: `${template.summary} A free ${brand.niche.descriptor} job description skeleton for this setting — customize the bracketed prompts and post in minutes.`,
    openGraph: {
      title,
      description: template.summary,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', images: [ogImage] },
    alternates: { canonical: `${brand.baseUrl}${LIBRARY_PATH}/${template.id}` },
  };
}

// Escape < and > so serialized content can never terminate the script
// element early (repo pattern: components/BreadcrumbSchema.tsx).
const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function JdTemplateDetailPage({ params }: Props) {
  const { id } = await params;
  const template = findTemplate(id);
  if (!template) notFound();

  const pageUrl = `${brand.baseUrl}${LIBRARY_PATH}/${template.id}`;
  const pageTitle = `${template.label} — ${brand.niche.short} Job Description Template`;
  // Registry-authored HTML with the neutral token fallbacks applied.
  const bodyHtml = renderTemplate(template, {});
  const related = JD_TEMPLATES.filter(
    (t) => t.category === template.category && t.id !== template.id,
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Article schema derives from the same registry entry the page renders. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: pageTitle,
            description: template.summary,
            image: `${brand.baseUrl}/api/og?title=${encodeURIComponent(pageTitle)}&type=page`,
            author: { '@type': 'Organization', name: brand.name },
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
            mainEntityOfPage: pageUrl,
          }),
        }}
      />

      {/* Hero */}
      <section className="py-10 md:py-14 text-white" style={{ background: 'linear-gradient(135deg, #831843, #BE185D)' }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-pink-200 mb-3">
              {TEMPLATE_CATEGORY_LABELS[template.category]} · {template.population}
            </p>
            <h1 className="text-2xl md:text-4xl font-bold mb-4">{template.label}</h1>
            <p className="text-base md:text-lg text-pink-100">{template.summary}</p>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'For Employers', href: '/for-employers' },
              { label: 'Resources', href: '/for-employers/resources' },
              { label: 'Templates', href: LIBRARY_PATH },
              { label: template.label },
            ]}
          />

          {/* How to use */}
          <div className="mb-8 rounded-xl p-5 flex gap-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <Info className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              This is a skeleton, not a finished posting: everything in [square brackets] is a prompt to replace with your actual specifics — visit lengths, EHR, schedule, salary range. Inside the{' '}
              <Link href="/post-job" className="underline font-medium" style={{ color: 'var(--color-primary)' }}>post-job form</Link>, picking this template also fills in your practice name and location from the fields you have already entered.
            </p>
          </div>

          {/* Template body — frozen registry HTML (see file header). */}
          <div
            className="jd-template-body rounded-xl p-6 md:p-10 mb-8"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />

          {/* CTA */}
          <div
            className="rounded-xl p-6 md:p-8 text-center mb-10"
            style={{ background: 'linear-gradient(135deg, #FDF2F8, #FCE7F3)', border: '1px solid rgba(190,24,93,0.2)' }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: '#831843' }}>
              Use this template in your posting
            </h2>
            <p className="text-sm mb-5 max-w-lg mx-auto" style={{ color: '#9D174D' }}>
              Open the post-job form and pick &ldquo;{template.label}&rdquo; from the description editor&apos;s template starters. Your first post is free with every feature included.
            </p>
            <Link
              href="/post-job"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm text-white"
              style={{ background: 'linear-gradient(145deg, #BE185D, #9D174D)' }}
            >
              Post a Job — First Post Free <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          {/* Related templates in the same category */}
          {related.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                More {TEMPLATE_CATEGORY_LABELS[template.category]} Templates
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {related.map((t) => (
                  <Link
                    key={t.id}
                    href={`${LIBRARY_PATH}/${t.id}`}
                    className="block rounded-xl p-4 transition-all hover:shadow-md"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                  >
                    <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--color-primary)' }}>{t.label}</h3>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.summary}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <Link
            href={LIBRARY_PATH}
            className="text-sm font-medium underline"
            style={{ color: 'var(--color-primary)' }}
          >
            Back to all {JD_TEMPLATES.length} templates
          </Link>
        </div>
      </div>

      {/* Typography for the registry HTML — scoped by the wrapper class.
          Static CSS only (no ${} interpolations — styled-jsx Turbopack
          deadlock note in project memory). */}
      <style>{`
        .jd-template-body h2 {
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 1.75rem 0 0.6rem;
        }
        .jd-template-body h2:first-child {
          margin-top: 0;
        }
        .jd-template-body h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 1.4rem 0 0.5rem;
        }
        .jd-template-body p {
          font-size: 0.925rem;
          line-height: 1.7;
          color: var(--text-secondary);
          margin: 0 0 0.75rem;
        }
        .jd-template-body ul {
          list-style: disc;
          padding-left: 1.4rem;
          margin: 0 0 1rem;
        }
        .jd-template-body li {
          font-size: 0.925rem;
          line-height: 1.65;
          color: var(--text-secondary);
          margin-bottom: 0.35rem;
        }
      `}</style>
    </div>
  );
}

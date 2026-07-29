/**
 * /tools — hub for the free tools (P2 #4, #5, #6, #17).
 *
 * Cards render from TOOLS in ./tools-registry.ts, the same array the
 * /resources tools band reads, so the hub can never advertise a tool that
 * does not exist.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BarChart3, Calculator, ClipboardCheck, Scale, type LucideIcon } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, clayCard, iconTile } from '@/components/tools/tool-theme';
import { TOOLS, TOOLS_HUB_PATH, type ToolAudience, type ToolIconKey } from './tools-registry';

const PAGE_URL = `${brand.baseUrl}${TOOLS_HUB_PATH}`;
const PAGE_TITLE = `Free ${brand.niche.short} Career Tools — Calculators, Comparisons & Benchmarks`;
const PAGE_DESCRIPTION = `Free interactive tools for ${brand.niche.descriptor}s and the teams hiring them: a 1099 vs W-2 take-home calculator, a cost-of-living salary comparison, a state licensure checker with multi-state planner, and a salary benchmark by state.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Free ${brand.niche.short} Career Tools`)}&type=page`;

export const metadata: Metadata = {
  title: `${PAGE_TITLE} | ${brand.name}`,
  description: PAGE_DESCRIPTION,
  keywords: [
    `free ${brand.niche.short.toLowerCase()} tools`,
    `${brand.niche.descriptor} salary calculator`,
    `${brand.niche.short.toLowerCase()} licensure checker`,
    `${brand.niche.short.toLowerCase()} cost of living comparison`,
    `${brand.niche.short.toLowerCase()} salary benchmark`,
  ],
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'website',
    url: PAGE_URL,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: PAGE_TITLE }],
  },
  twitter: { card: 'summary_large_image', title: PAGE_TITLE, images: [OG_IMAGE] },
  alternates: { canonical: PAGE_URL },
};

const ICONS: Record<ToolIconKey, LucideIcon> = {
  calculator: Calculator,
  scale: Scale,
  clipboard: ClipboardCheck,
  chart: BarChart3,
};

const AUDIENCE_META: Record<ToolAudience, { label: string; color: string; bg: string }> = {
  seeker: { label: 'For clinicians', color: '#BE185D', bg: '#FDF2F8' },
  employer: { label: 'For employers', color: '#4338CA', bg: '#EEF2FF' },
};

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function ToolsHubPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: PAGE_TITLE,
            description: PAGE_DESCRIPTION,
            url: PAGE_URL,
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
            hasPart: TOOLS.map((tool) => ({
              '@type': 'WebApplication',
              name: tool.title,
              description: tool.blurb,
              url: `${brand.baseUrl}${tool.path}`,
              applicationCategory: tool.audience === 'employer' ? 'BusinessApplication' : 'FinanceApplication',
              operatingSystem: 'Any',
              isAccessibleForFree: true,
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            })),
            numberOfItems: TOOLS.length,
          }),
        }}
      />

      <div style={{ background: TOOL_HERO_BG }}>
        <section style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 20px 64px' }}>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Tools' }]} />
          <div style={{ maxWidth: '720px', marginBottom: '40px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tools
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} career tools
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Four calculators built on the same data as the rest of this site — live postings, published
              federal tax figures, and sourced regulatory data. Every one shows its working: what it assumes,
              what it excludes, and where the numbers came from.
            </p>
          </div>

          <div className="tools-hub-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {TOOLS.map((tool) => {
              const Icon = ICONS[tool.icon];
              const audience = AUDIENCE_META[tool.audience];
              return (
                <Link
                  key={tool.path}
                  href={tool.path}
                  className="tool-card"
                  style={{ ...clayCard, padding: '26px 24px 22px', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: '13px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <span style={{ ...iconTile, background: audience.bg, color: audience.color }} aria-hidden="true">
                      <Icon size={23} />
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: audience.color, background: audience.bg, padding: '4px 11px', borderRadius: '20px' }}>
                      {tool.badge}
                    </span>
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.3 }}>{tool.title}</h2>
                  <p style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.6, margin: 0, flex: 1 }}>{tool.blurb}</p>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: TOOL_ACCENT }}>
                    Open the tool <ArrowRight size={14} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section style={{ background: '#FFF', padding: '56px 20px 72px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', textAlign: 'center' }}>
          <h2 className="font-lora" style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35', margin: '0 0 12px' }}>
            Prefer to read?
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.65, margin: '0 0 22px' }}>
            The guides go deeper than the calculators: full practice authority state by state, private-practice
            startup mechanics, and the full 1099 vs W2 comparison.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
            {[
              { href: '/resources', label: 'Career resources' },
              { href: '/salary-guide', label: `${brand.niche.short} salary guide` },
              { href: '/resources/1099-vs-w2', label: '1099 vs W2 guide' },
              { href: '/resources/fpa-guide', label: 'Full practice authority' },
              { href: '/for-employers/resources', label: 'Employer resources' },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '22px', background: '#FDF2F8', color: TOOL_ACCENT, fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
              >
                {l.label} <ArrowRight size={13} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <style>{TOOL_PAGE_CSS}</style>
      <style>{`
        @media (max-width: 780px) {
          .tools-hub-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

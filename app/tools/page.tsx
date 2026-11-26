/**
 * /tools — hub for the free tools (P2 #4, #5, #6, #17; P3 #2, #6a, #6b;
 * Tools Suite 2026-11-26).
 *
 * Cards render from TOOLS in ./tools-registry.ts, the same array the
 * /resources tools band reads, so the hub can never advertise a tool that
 * does not exist. The visible count derives from that array too — a
 * hand-typed count goes stale whenever a tool ships.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Compass,
  DollarSign,
  FileText,
  GraduationCap,
  Layers,
  Scale,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import GuidePromo from '@/components/guides/GuidePromo';
import ToolsHubFilterClient, { type HubToolCardItem } from '@/components/tools/ToolsHubFilterClient';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG } from '@/components/tools/tool-theme';
import { TOOLS, TOOLS_HUB_PATH, type ToolIconKey } from './tools-registry';

const PAGE_URL = `${brand.baseUrl}${TOOLS_HUB_PATH}`;
const PAGE_TITLE = `Free ${brand.niche.long} Tools and Calculators`;
const PAGE_DESCRIPTION = `Free ${brand.niche.descriptor} tools for clinicians and employers: pay calculators, wRVU and E/M coding, licensure, loan repayment, pay transparency, and clinic ROI.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Free ${brand.niche.long} Tools`)}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: no manual brand suffix — the root layout's title
  // template (`%s | ${brand.name}`) appends it.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} tools and calculators`,
    `free ${brand.niche.short.toLowerCase()} tools`,
    `${brand.niche.descriptor} salary calculator`,
    `${brand.niche.short.toLowerCase()} wrvu calculator`,
    `${brand.niche.short.toLowerCase()} em coding calculator`,
    `${brand.niche.short.toLowerCase()} licensure checker`,
    `${brand.niche.short.toLowerCase()} loan repayment calculator`,
    `${brand.niche.short.toLowerCase()} salary benchmark`,
    'cost per hire calculator',
    'pay transparency checker',
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
  compass: Compass,
  building: Building2,
  briefcase: Briefcase,
  shield: ShieldCheck,
  clock: Clock,
  sparkles: Sparkles,
  layers: Layers,
  check: CheckCircle2,
  graduation: GraduationCap,
  activity: Activity,
  fileText: FileText,
  arrows: ArrowLeftRight,
  dollar: DollarSign,
};

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function ToolsHubPage() {
  const hubItems: HubToolCardItem[] = TOOLS.map((tool) => {
    const Icon = ICONS[tool.icon];
    return {
      path: tool.path,
      title: tool.title,
      blurb: tool.blurb,
      badge: tool.badge,
      audience: tool.audience,
      category: tool.category ?? 'Compensation & Offers',
      iconNode: <Icon size={23} />,
    };
  });

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
            publisher: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, url: brand.baseUrl },
            hasPart: TOOLS.map((tool) => ({
              '@type': 'WebApplication',
              name: tool.title,
              description: tool.blurb,
              url: `${brand.baseUrl}${tool.path}`,
              applicationCategory: tool.applicationCategory,
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
          <div style={{ maxWidth: '760px', marginBottom: '32px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tools Suite
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} career & hiring tools
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              {TOOLS.length} tools built on the same data as the rest of this site: live postings, published
              federal tax and fee schedules, sourced regulatory data, and our own published prices.
            </p>
          </div>

          <ToolsHubFilterClient items={hubItems} />

          <GuidePromo
            slug="career-bundle"
            heading="Ready for the interview and the offer?"
            pitch="Four guides: the first-year roadmap, interview answers, negotiation scripts and the pay data behind your ask."
            style={{ marginTop: '40px' }}
          />
        </section>
      </div>

      <section style={{ background: '#FFF', padding: '56px 20px 72px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', textAlign: 'center' }}>
          <h2 className="font-lora" style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35', margin: '0 0 22px' }}>
            Prefer to read?
          </h2>
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

import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import EmployerHowItWorks from '@/components/EmployerHowItWorks';
import { config } from '@/lib/config';
import {
  Check, ArrowRight, X, Calendar, Star, TrendingUp, Mail, Users, Briefcase, BarChart3, DollarSign,
} from 'lucide-react';

const STORAGE_BASE = brand.assets.storageBase;

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `For Employers — Hire ${brand.niche.short}s | ${brand.niche.short} Job Board`,
  // Trimmed from 189 chars to ~145 for SERP display (audit 09 M-20).
  description:
    `Hire ${brand.niche.long}s. First post free — all features included. Reach thousands actively searching for ${brand.niche.short} roles.`,
  openGraph: {
    // Edge-generated OG card — no dependency on storage assets that don't
    // exist on this board (the old pmhnp-*.webp URL 400s).
    images: [{ url: `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Hire ${brand.niche.short}s — first post free`)}&type=page`, width: 1200, height: 630, alt: `${brand.niche.short} employer hiring solutions` }],
  },
  twitter: { card: 'summary_large_image', images: [`${brand.baseUrl}/api/og?title=${encodeURIComponent(`Hire ${brand.niche.short}s — first post free`)}&type=page`] },
  alternates: { canonical: `${brand.baseUrl}/for-employers` },
};

/* ═══ Design Tokens — matched to homepage ═══ */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const iconBg: React.CSSProperties = {
  width: '48px',
  height: '48px',
  borderRadius: '12px',
  background: '#D4E2D4',
  color: '#1E3A5F',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
};

const iconBgCentered: React.CSSProperties = {
  ...iconBg,
  margin: '0 auto 14px',
};



const comparisonRows: { feature: string; us: true | false | 'partial'; indeed: true | false | 'partial'; linkedin: true | false | 'partial'; note?: string }[] = [
  { feature: `100% ${brand.niche.medium} Audience`, us: true, indeed: false, linkedin: false },
  { feature: 'No Unqualified Applicants', us: true, indeed: false, linkedin: false },
  { feature: `First Post Free (No Card)`, us: true, indeed: false, linkedin: false },
  { feature: `Flat $${config.postingPrice}/Post — No Bidding`, us: true, indeed: false, linkedin: false, note: 'Indeed is pay-per-click' },
  { feature: `${config.durationDays}-Day Listing Duration`, us: true, indeed: false, linkedin: false, note: 'Others: 30 days' },
  { feature: 'Direct Candidate Messaging', us: true, indeed: false, linkedin: 'partial', note: 'LinkedIn: paid add-on' },
  { feature: 'Candidate Profile Unlocks', us: true, indeed: false, linkedin: 'partial', note: 'LinkedIn: paid add-on' },
  { feature: 'Built-In Screening Questions', us: true, indeed: true, linkedin: false },
  { feature: 'Daily Niche Job Alerts', us: true, indeed: 'partial', linkedin: 'partial', note: 'Others: generic alerts' },
  { feature: 'Instant Apply Notifications', us: true, indeed: true, linkedin: true },
];

export default async function ForEmployersPage() {
  return (
    <>
      <BreadcrumbSchema items={[{ name: 'Home', url: brand.baseUrl }, { name: 'For Employers', url: `${brand.baseUrl}/for-employers` }]} />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: RECEIPT HERO — "one flat price" (user-approved EH4
          mock, 2026-07-10). Cream + faint grid stage matching the
          homepage; the old salmon band, its dead Supabase illustration,
          and the stat pills (which rendered a literal "0+ Job Seekers"
          on this young board) are gone.
          ═══════════════════════════════════════════════════════════════ */}
      <section
        style={{
          backgroundColor: '#F5F0EB',
          backgroundImage:
            'linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          padding: '64px 0 72px',
        }}
      >
        <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '0 24px' }}>
          <div className="emp-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '48px', alignItems: 'center' }}>
            {/* Left — statement */}
            <div>
              <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#BE185D', margin: '0 0 16px' }}>
                For hiring teams
              </p>
              <h1 className="font-heading" style={{
                fontSize: 'clamp(34px, 4.4vw, 54px)', fontWeight: 700, lineHeight: 1.05,
                textTransform: 'uppercase', color: '#7A1C2B', margin: '0 0 18px', letterSpacing: '-0.01em',
              }}>
                One flat price.<br />
                The whole {brand.niche.short} market.
              </h1>

              <p style={{
                fontSize: '16px', color: '#5f4a50', lineHeight: 1.7, fontWeight: 600,
                margin: '0 0 28px', maxWidth: '460px',
              }}>
                No bidding wars, no per-click billing, no surprise invoices. Every candidate here is a {brand.niche.descriptor} — post once, reach the whole market.
              </p>

              {/* CTA Buttons — No Sugar */}
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Link href="/post-job" style={{
                  display: 'inline-flex', alignItems: 'center', gap: '9px',
                  padding: '14px 28px', fontSize: '14px', fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: '#fff', background: '#BE185D',
                  border: '2px solid #7A1C2B', boxShadow: '5px 5px 0 #7A1C2B',
                  textDecoration: 'none', transition: 'transform 0.15s ease',
                }}>
                  Post a Job — Free <ArrowRight size={16} />
                </Link>
                <Link href="/pricing" style={{
                  display: 'inline-flex', alignItems: 'center', gap: '9px',
                  padding: '14px 28px', fontSize: '14px', fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: '#7A1C2B', background: '#fff',
                  border: '2px solid #7A1C2B', boxShadow: '5px 5px 0 #7A1C2B',
                  textDecoration: 'none', transition: 'transform 0.15s ease',
                }}>
                  View Pricing
                </Link>
              </div>
            </div>

            {/* Right — the receipt. Line items mirror the Full Package bento
                below; numbers come from lib/config so pricing changes stay
                in one place. */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="emp-receipt" style={{
                width: '100%', maxWidth: '340px', background: '#fff',
                border: '2px solid #7A1C2B', boxShadow: '7px 7px 0 #7A1C2B',
                padding: '26px 26px 20px', fontFamily: "Consolas, 'Courier New', monospace",
                transform: 'rotate(1.2deg)',
              }}>
                <p className="font-heading" style={{ textTransform: 'uppercase', textAlign: 'center', fontSize: '16px', fontWeight: 700, color: '#7A1C2B', margin: '0 0 4px', letterSpacing: '0.06em' }}>
                  {brand.name} · Job Post
                </p>
                <p style={{ textAlign: 'center', fontSize: '10.5px', color: '#9b8291', margin: '0 0 14px', letterSpacing: '0.05em' }}>
                  *** EVERYTHING INCLUDED ***
                </p>
                {[
                  `${config.durationDays}-day listing`,
                  'Featured badge',
                  '25 candidate unlocks',
                  '25 InMails',
                  'Live analytics',
                  'Daily alert placement',
                ].map((item) => (
                  <div key={item} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: '#4a3a40', padding: '7px 0', borderBottom: '1px dashed rgba(122,28,43,0.25)' }}>
                    <span>{item}</span>
                    <Check size={14} style={{ color: '#7A1C2B', flexShrink: 0 }} />
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, color: '#7A1C2B', padding: '12px 0 4px' }}>
                  <span>TOTAL / POST</span>
                  <span>${config.postingPrice} flat</span>
                </div>
                <div style={{
                  background: '#B9EBD6', border: '2px solid #7A1C2B', boxShadow: '3px 3px 0 #7A1C2B',
                  textAlign: 'center', fontWeight: 800, fontSize: '12px', textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: '#7A1C2B', padding: '9px', marginTop: '14px',
                  transform: 'rotate(-1.5deg)',
                }}>
                  First post: FREE
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2: HOW EMPLOYERS HIRE (shared component from homepage)
          ═══════════════════════════════════════════════════════════════ */}
      <EmployerHowItWorks />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3: BENTO GRID FEATURES
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '80px 20px 56px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            First Post Free · Then ${config.postingPrice}/post
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
            Every Post Gets the Full Package
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>
            No tiers. No feature gates. Free or paid — every listing gets the same premium treatment.
          </p>

          {/* ─── Bento Grid ─── */}
          <div className="bento-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gridTemplateRows: 'auto',
            gap: '14px',
          }}>

            {/* ROW 1: 60-Day Listing (8 cols) + Featured Badge (4 cols) */}
            <div className="bento-hero-1 emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden',
              display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
            }}>
              <div style={{ padding: '32px 28px' }}>
                <div style={iconBg}>
                  <Calendar size={24} />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>60-Day Listing</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  Double the industry standard. Your job stays visible for 2 full months — no daily budget, no bidding.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px' }}>
                <Image src="/images/employers/bento-60day.webp" alt="60-day job listing calendar" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="bento-hero-2 emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Image src="/images/employers/bento-featured.webp" alt="Featured badge on job listing" width={200} height={140} style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
              </div>
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <div style={iconBg}>
                  <Star size={22} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Featured Badge</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  Stand out with a prominent Featured tag on your listing and in search results.
                </p>
              </div>
            </div>

            {/* ROW 2: 4 compact cards (3 cols each) — CENTERED */}
            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <TrendingUp size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Top Search Placement</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Featured listings rank higher — more visibility, more clicks.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <Mail size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Daily Job Alerts</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Highlighted in daily email digests to opted-in {brand.niche.short}s.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <Users size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{config.limits.candidateUnlocksPerPosting} Candidate Unlocks</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>View full profiles — contact info, resume, LinkedIn.</p>
            </div>

            <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <div style={iconBgCentered}>
                <Briefcase size={22} />
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{config.limits.inmailsPerPosting} InMails</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Message candidates directly — no guessing emails.</p>
            </div>

            {/* ROW 3: Analytics (8 cols) + Pricing (4 cols) */}
            <div className="bento-hero-3 emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden',
              display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
            }}>
              <div style={{ padding: '32px 28px' }}>
                <div style={iconBg}>
                  <BarChart3 size={24} />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Live Analytics</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  Track views, clicks, and applications in real time. See exactly where your candidates come from.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                <Image src="/images/employers/bento-analytics.webp" alt="Analytics dashboard with charts" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="bento-pricing emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 4',
              padding: '28px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
              background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
              border: '2px solid rgba(190,24,93,0.15)',
            }}>
              <div style={{ ...iconBg, background: 'rgba(190,24,93,0.1)', color: '#BE185D' }}>
                <DollarSign size={22} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#831843', margin: '0 0 6px' }}>Simple Pricing</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', margin: '0 0 16px', lineHeight: 1.6, fontWeight: 500 }}>
                First post free. Then ${config.postingPrice}/post.<br />
                Renewals just ${config.renewalPrice}. No hidden fees.
              </p>
              <Link href="/post-job" className="emp-cta-primary" style={{
                padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                background: '#BE185D', color: '#fff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
              }}>
                Post a Job <ArrowRight size={14} />
              </Link>
            </div>

          </div>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: COMPARISON + CTA (split screen, same section)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Why Switch
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
            How We Compare
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '440px', margin: '0 auto 44px', lineHeight: 1.6 }}>
            An honest look at what you get — no cherry-picking.
          </p>

          {/* Split: Table (left) + CTA Card (right) */}
          <div className="emp-compare-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>

            {/* LEFT — Comparison Table */}
            <div className="emp-compare-table" style={{ ...clayCard, padding: '0', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                    <th style={{ width: '40%', padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                    <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 800, color: '#BE185D', borderBottom: '2px solid rgba(190,24,93,0.2)', fontSize: '12px' }}>{brand.name}</th>
                    <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>Indeed</th>
                    <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>LinkedIn</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row, i) => {
                    const renderCell = (val: true | false | 'partial', isUs: boolean) => {
                      if (val === true) return <Check size={16} style={{ color: isUs ? '#BE185D' : '#94A3B8', display: 'block', margin: '0 auto' }} />;
                      if (val === 'partial') return <span style={{ fontSize: '11px', color: '#F59E0B', fontWeight: 600 }}>Partial</span>;
                      return <X size={16} style={{ color: '#D1D5DB', display: 'block', margin: '0 auto' }} />;
                    };
                    return (
                      <tr key={row.feature} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                        <td style={{ padding: '12px 24px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                          <span style={{ color: '#1A2E35', fontWeight: 500 }}>{row.feature}</span>
                          {row.note && <span style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{row.note}</span>}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(190,24,93,0.03)' }}>
                          {renderCell(row.us, true)}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                          {renderCell(row.indeed, false)}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                          {renderCell(row.linkedin, false)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* RIGHT — Vertical CTA Card (image top, content bottom) */}
            <div style={{
              ...clayCard, padding: '0', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Image */}
              <div style={{
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Image
                  src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/cta-illustration.webp`}
                  alt={`Successful ${brand.niche.short} hiring celebration`}
                  width={280} height={220}
                  style={{ width: '100%', maxWidth: '260px', height: 'auto', borderRadius: '14px' }}
                />
              </div>

              {/* Content */}
              <div style={{ padding: '28px 24px' }}>
                <h3 className="font-lora" style={{
                  fontSize: '20px', fontWeight: 700,
                  color: '#1A2E35', margin: '0 0 10px',
                }}>
                  Ready to Hire Your{' '}
                  <span style={{ color: '#BE185D' }}>Next {brand.niche.short}</span>?
                </h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 20px' }}>
                  First post free — all features included. Then just ${config.postingPrice}/post.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <Link href="/post-job" className="emp-cta-primary" style={{
                    padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px',
                    background: 'linear-gradient(145deg, #BE185D, #9D174D)', color: '#fff',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: '4px 4px 12px rgba(190,24,93,0.2), inset 1px 1px 2px rgba(255,255,255,0.15)',
                  }}>
                    Post a Job — First Post Free <ArrowRight size={15} />
                  </Link>
                  <Link href="/contact" className="emp-cta-secondary" style={{
                    padding: '12px 24px', borderRadius: '12px', fontWeight: 600, fontSize: '14px',
                    background: '#fff', color: '#1A2E35', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    border: '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '2px 2px 6px rgba(0,0,0,0.04)',
                  }}>
                    Contact Us
                  </Link>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═══ Responsive overrides ═══ */}
      <style>{`
        /* ─── Hover effects ─── */
        .emp-cta-primary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
        }
        .emp-cta-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 32px rgba(190,24,93,0.35), inset 1px 1px 2px rgba(255,255,255,0.2) !important;
          filter: brightness(1.05);
        }
        .emp-cta-secondary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .emp-cta-secondary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.08) !important;
          border-color: rgba(190,24,93,0.3) !important;
        }
        .emp-bento-card {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .emp-bento-card:hover {
          transform: translateY(-4px);
          box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important;
        }
        .emp-compare-table tr {
          transition: background 0.2s ease;
        }
        .emp-compare-table tbody tr:hover {
          background: rgba(190,24,93,0.04) !important;
        }
        .emp-stat-pill {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .emp-stat-pill:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important;
        }

        /* ─── Responsive ─── */
        @media (max-width: 768px) {
          .emp-hero-grid { grid-template-columns: 1fr !important; }
          .emp-compare-grid { grid-template-columns: 1fr !important; }
          .emp-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .bento-grid { grid-template-columns: 1fr !important; }
          .bento-hero-1, .bento-hero-2, .bento-hero-3, .bento-pricing {
            grid-column: span 1 !important;
          }
          .bento-hero-1, .bento-hero-3 {
            grid-template-columns: 1fr !important;
          }
          .bento-grid > div { grid-column: span 1 !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .bento-hero-1, .bento-hero-3 { grid-column: span 6 !important; }
          .bento-hero-2, .bento-pricing { grid-column: span 6 !important; }
          .bento-grid > div:not(.bento-hero-1):not(.bento-hero-2):not(.bento-hero-3):not(.bento-pricing) {
            grid-column: span 3 !important;
          }
        }
      `}</style>
    </>
  );
}

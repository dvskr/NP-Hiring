'use client';
import Link from 'next/link';
import './about.css';
import { Briefcase, Users, MapPin, RefreshCw, CheckCircle, DollarSign, CalendarDays, Target, BarChart3, Layers, Shield, ArrowRight, Play } from 'lucide-react';
import { brand } from '@/config/brand';

/**
 * A bucket count of `null` means "below the display floor or unavailable" —
 * the diorama keeps its label and OMITS the count line (live review
 * 2026-08-17 item #4b: never render a fabricated or padded number).
 */
interface DioramaCounts {
  newGrad: number | null;
  inpatient: number | null;
  telehealth: number | null;
  outpatient: number | null;
}

interface AboutClientProps {
  totalJobs: number;
  totalEmployers: number;
  // Optional for safe deploy: a parent that doesn't pass it gets dioramas
  // with no count lines. The previous fallback split totalJobs into invented
  // proportions (5%/20%/35%/18%) — that was a fabricated statistic, so the
  // omission path replaced it (live review item #4b, omit-not-fabricate).
  dioramaCounts?: DioramaCounts;
}

export default function AboutClient({ totalJobs, totalEmployers, dioramaCounts }: AboutClientProps) {
  // SEO Fix M16: render live counts from Prisma instead of the hardcoded
  // 320/1,240/2,105/885 strings the audit flagged. Counts arrive already
  // floor-gated by app/about/page.tsx from the canonical predicate
  // (lib/canonical-counts.ts) — the same clauses the filter pages use.
  const counts: DioramaCounts = dioramaCounts ?? {
    newGrad: null,
    inpatient: null,
    telehealth: null,
    outpatient: null,
  };
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="ab-body">
      {/* ═══ HERO ═══ */}
      <section className="ab-hero">
        <div className="ab-wrap" style={{ textAlign: 'center' }}>
          <div className="ab-eyebrow"><span className="pulse" /> Dedicated Infrastructure · Est. 2026</div>
          <div className="ab-hero-head">
            <h1>We&apos;re shaping the <em>future</em><br />of <span className="clay-underline">{brand.niche.short}</span> careers.</h1>
            {/* Live review item 8a (WP-5): "The only job platform" (unverifiable
                superlative) and "No generic noise — just roles that match your
                scope" (absolute inventory guarantee falsified by review items
                1a–1d) were softened to the screening commitment. The absolutes
                may return only when the WP-1 inventory-invariant test is green. */}
            <p className="ab-hero-sub" style={{ textAlign: 'center' }}>A job platform built exclusively for {brand.niche.long}s and APRNs. Listings are screened at ingest and removed when flagged out of scope — so your search starts with relevant roles, not generic noise.</p>
            <div className="ab-hero-cta">
              <Link href="/jobs" className="ab-btn ab-btn-primary">Browse open roles <ArrowRight size={16} /></Link>
              <Link href="/resources" className="ab-btn ab-btn-ghost">All Resources</Link>
            </div>
          </div>

          {/* CLAY DIORAMA */}
          <div className="ab-clay-stage">
            <div className="ab-diorama">
              <div className="ab-scene" style={{ minHeight: 320, background: 'linear-gradient(160deg, #D6E8DE, #B5D1C3)', padding: 0 }}>
                <img src="/images/how-it-works/seeker-step4-v2.webp" alt="New graduate starting a first role" width={1024} height={1024} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '28px 28px 0 0' }} />
                <div style={{ padding: '16px 20px' }}><div className="label">New&nbsp;Grad<br />friendly</div>{counts.newGrad !== null && <div className="meta" style={{ marginTop: 10 }}>{fmt(counts.newGrad)} roles</div>}</div>
              </div>
              <div className="ab-scene teal" style={{ minHeight: 380, padding: 0 }}>
                <img src="/images/job-seekers/clinical-inperson.webp" alt="Inpatient & acute care" width={400} height={300} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '28px 28px 0 0' }} />
                <div style={{ padding: '16px 20px' }}><div className="label">Acute &amp;<br />inpatient units</div>{counts.inpatient !== null && <div className="meta" style={{ marginTop: 10 }}>{fmt(counts.inpatient)} roles</div>}</div>
              </div>
              <div className="ab-scene coral" style={{ minHeight: 350, padding: 0 }}>
                <img src="/images/job-seekers/remote-telehealth.webp" alt="Telehealth remote practice" width={400} height={300} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '28px 28px 0 0' }} />
                <div style={{ padding: '16px 20px' }}><div className="label">Remote<br />practice</div>{counts.telehealth !== null && <div className="meta" style={{ marginTop: 10 }}>{fmt(counts.telehealth)} listings</div>}</div>
              </div>
              <div className="ab-scene" style={{ minHeight: 310, background: 'linear-gradient(160deg, #F3D7A8, #E3BC7B)', padding: 0 }}>
                <img src="/images/job-seekers/private-practice.webp" alt="Outpatient community clinics" width={400} height={300} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '28px 28px 0 0' }} />
                <div style={{ padding: '16px 20px' }}><div className="label">Community<br />clinics</div>{counts.outpatient !== null && <div className="meta" style={{ marginTop: 10 }}>{fmt(counts.outpatient)} openings</div>}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section><div className="ab-wrap">
        <div className="ab-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* Live review item #4a/#4c: exact canonical counts — the "+"
              suffix implied more inventory than /jobs actually browses, and
              the old "Verified" qualifier on the employer stat claimed a
              verification filter this count never applied (it is every
              employer with an active listing). */}
          <div className="ab-stat"><div className="ico"><Briefcase size={24} /></div><div className="num">{totalJobs.toLocaleString()}</div><div className="lab">Active Jobs</div></div>
          <div className="ab-stat"><div className="ico"><Users size={24} /></div><div className="num">{totalEmployers.toLocaleString()}</div><div className="lab">Employers</div></div>
          <div className="ab-stat"><div className="ico"><MapPin size={24} /></div><div className="num">50</div><div className="lab">States Covered</div></div>
        </div>
      </div></section>

      {/* ═══ FOR PMHNPs ═══ */}
      <section className="ab-pad"><div className="ab-wrap">
        <div className="ab-two-col">
          <div>
            <span className="ab-kicker"><Target size={12} /> For {brand.niche.short}s</span>
            <h2 style={{ marginTop: 20 }}>Stop scrolling past generic <em>RN postings.</em></h2>
            {/* Live review item 8a variant (WP-5): "only lists" was the same
                absolute inventory guarantee — restated as the screen. */}
            <p style={{ marginTop: 22, color: 'var(--ink-soft)', fontSize: 18, maxWidth: 540 }}>General nursing boards bury {brand.niche.short} roles under thousands of RN postings. This site is built for {brand.niche.short} jobs — screened at ingest, and filtered by setting, salary, license, and the actual scope of practice you train in.</p>
            <div className="ab-feat-list">
              {/* Live review WP-5 sweep: "100%" and "Unmatched" superlatives
                  dropped; "thousands of real-time listings" was an invented
                  inventory count. */}
              <div className="ab-feat"><div className="ab-feat-ico"><CheckCircle size={22} /></div><div><h4>Specialized Filters</h4><p>Search by clinical setting — Inpatient, Outpatient, Telehealth, Urgent Care, Correctional, Geriatric — instead of typical nursing tags.</p></div></div>
              <div className="ab-feat"><div className="ab-feat-ico coral"><DollarSign size={22} /></div><div><h4>Salary Transparency</h4><p>We show employer-posted pay ranges next to BLS state benchmarks, so you negotiate from published numbers instead of guesses.</p></div></div>
              {/* Live review item 8d (WP-5): "you only ever see roles you can
                  actually accept" promised a license-to-listing eligibility
                  mechanism that does not exist. Restated as the measurable
                  feature — filters the product actually has. */}
              <div className="ab-feat"><div className="ab-feat-ico" style={{ color: '#6F63C0' }}><CalendarDays size={22} /></div><div><h4>Licensure-aware Alerts</h4><p>Filter alerts by state, compact eligibility, and specialty so your feed matches where you can practice.</p></div></div>
            </div>
            <Link href="/signup" className="ab-btn ab-btn-primary" style={{ marginTop: 36 }}>Create a free profile <ArrowRight size={16} /></Link>
          </div>
          <div>
            <div className="ab-diorama-card mint" style={{ padding: 0 }}>
              <img src="/images/how-it-works/seeker-step1-v2.webp" alt={`Career growth for ${brand.niche.short}s`} width={1024} height={1024} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '40px 40px 0 0' }} />
              <div style={{ padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontFamily: "var(--font-lora), 'Lora', serif", fontSize: 18 }}>Chart your path, step by step.</b>
                <span className="chip">{brand.niche.short} · 2026</span>
              </div>
            </div>
          </div>
        </div>
      </div></section>

      {/* ═══ FOR EMPLOYERS ═══ */}
      <section className="ab-pad ab-emp-section"><div className="ab-wrap">
        <div className="ab-two-col flip">
          <div>
            <div className="ab-diorama-card peach" style={{ padding: 0 }}>
              <img src="/images/how-it-works/step-employer-track-v5.webp" alt="Employer hiring dashboard" width={572} height={572} loading="lazy" decoding="async" style={{ width: '100%', flex: 1, objectFit: 'cover', borderRadius: '40px 40px 0 0' }} />
              <div style={{ padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontFamily: "var(--font-lora), 'Lora', serif", fontSize: 18 }}>A team room, not a newsstand.</b>
                <span className="chip">Dashboard</span>
              </div>
            </div>
          </div>
          <div>
            <span className="ab-kicker coral"><ArrowRight size={12} /> For Employers</span>
            <h2 style={{ marginTop: 20 }}>Zero-waste <em>candidate sourcing.</em></h2>
            {/* Live review item 8c variant (WP-5): "every visitor is a
                practicing or about-to-practice NP" was the 100%-NP-audience
                claim — we can verify what we list, not who is reading. The
                competitor-applicant disparagement was unverifiable too. */}
            <p style={{ marginTop: 22, color: 'var(--ink-soft)', fontSize: 18, maxWidth: 540 }}>Skip generic aggregators where your posting competes with every industry. Post directly to a board built for {brand.niche.short} and APRN roles, so your listing reaches people searching for exactly this work.</p>
            <div className="ab-feat-list">
              {/* Live review WP-5 sweep: "vastly higher conversion rates" was
                  an unmeasured performance promise — no conversion claim until
                  it is measured. Restated as the verifiable context. */}
              <div className="ab-feat"><div className="ab-feat-ico coral"><Target size={22} /></div><div><h4>Focused Context</h4><p>Your posting appears alongside {brand.niche.short} roles only — never buried in a cross-industry feed.</p></div></div>
              <div className="ab-feat"><div className="ab-feat-ico" style={{ color: '#6F63C0' }}><BarChart3 size={22} /></div><div><h4>Analytics & Placements</h4><p>Secure featured placements and monitor actionable apply-funnel analytics directly from your verified employer dashboard.</p></div></div>
              <div className="ab-feat"><div className="ab-feat-ico"><Layers size={22} /></div><div><h4>Calibrated Matching</h4><p>Our taxonomy maps exact specialties — acute care, primary care, geriatrics, women&apos;s health — so you spend less time filtering and more time hiring.</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap' }}>
              <Link href="/employers" className="ab-btn ab-btn-primary">Post a role</Link>
            </div>
          </div>
        </div>
      </div></section>

      {/* ═══ METHODOLOGY ═══ */}
      <section className="ab-pad"><div className="ab-wrap">
        <div className="ab-method-head">
          <span className="ab-kicker lav"><Layers size={12} /> Our methodology</span>
          <h2 style={{ marginTop: 20 }}>Hard data. <em>No assumptions.</em></h2>
          <p>Accuracy isn&apos;t optional. Listings are ingested from employer ATS feeds and direct posts, screened against published relevance rules, and swept for expiry on a daily cycle.</p>
        </div>
        <div className="ab-method-grid">
          <div className="ab-method-card featured"><span className="num-tag">01</span><div className="mi"><Layers size={28} /></div><h3>Multi-Vector Aggregation</h3><p>We synthesize endpoints from the Bureau of Labor Statistics, native ATS feeds, and direct employer postings into a single streamlined view.</p></div>
          {/* Live review item 8b (WP-5): the card claimed listings are
              "fact-checked against state nursing boards" (no such mechanism
              exists) and "we never inflate salaries" (falsified by review
              item 2 — published annualization errors). Both sentences
              REMOVED. A salary-integrity claim ("ranges validated against
              BLS-anchored bounds at ingest") may be added ONLY after the
              WP-2 salary rebuild lands and makes it true. */}
          <div className="ab-method-card"><span className="num-tag">02</span><div className="mi" style={{ color: 'var(--coral)' }}><Shield size={28} /></div><h3>Editorial Integrity</h3><p>Every listing traces to an employer ATS feed or a direct employer post — screened against our published relevance rules at ingest, and removed when flagged out of scope.</p></div>
          <div className="ab-method-card"><span className="num-tag">03</span><div className="mi" style={{ color: '#6F63C0' }}><RefreshCw size={28} /></div><h3>Continuous Sync</h3><p>Stale listings are useless. Our system automatically purges expired opportunities and fetches exact market data on a strict 24-hour cycle.</p></div>
        </div>
      </div></section>

      {/* ═══ CREATOR ═══ */}
      {/* SEO Fix H10/H14: visible creator attribution with full name, plain
          founder-voice English (no LLM-tells). Per attribution rules the
          word "founder" is intentionally not used in user-visible content;
          the legal LLC member appears only in legal contexts. */}
      <section className="ab-pad" style={{ paddingTop: 40 }}><div className="ab-wrap">
        <div className="ab-creator">
          <div className="ab-portrait"><div className="bust" /><div className="tag-flo">{brand.legal.creatorTitle}</div></div>
          <div className="ab-creator-body">
            <span className="ab-kicker"><Users size={12} /> Who built this</span>
            <h2 style={{ marginTop: 20 }}>One person, one focused job board.</h2>
            <p>I built {brand.name} because every general nursing job site I looked at made {brand.niche.short}s do the same thing over and over: filter out hundreds of unrelated RN postings just to find the handful of {brand.niche.short} roles. There was no good reason for that, so I built something focused on one profession instead.</p>
            <p>I&apos;m a solo developer who built this entire project end to end, and I&apos;m not a clinician. My job here is the data pipeline — pulling job postings, normalizing salary fields, mapping state licensure rules, and surfacing the result through a fast, ad-light interface. The clinical content on this site is editorial commentary aggregated from public sources, not medical advice.</p>
            <p>If something on the site is wrong, missing, or could be better, the fastest way to reach me is the <Link href="/contact" style={{ color: 'inherit', textDecoration: 'underline' }}>contact page</Link>.</p>
            <div className="ab-sig">
              <div className="ab-sig-mark">SK</div>
              <div>
                <div className="name">{brand.legal.creatorName}</div>
                <div className="role">Creator of {brand.name}</div>
              </div>
            </div>
            <p style={{ marginTop: 28, fontSize: 13, color: 'var(--ink-soft, #6B7F8A)', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 18 }}>
              {brand.name} is a service operated by <strong>{brand.legal.entityName}</strong>, a {brand.legal.jurisdiction.split(',')[0]} limited liability company headquartered at {brand.legal.address}.
            </p>
          </div>
        </div>
      </div></section>

      {/* ═══ TESTIMONIALS ═══ */}
      {/* SEO Fix H11: testimonials section removed. The previous quotes named
          "Maya R., PMHNP-BC", "Daniel O., DNP, PMHNP", and "Dr. Priya M."
          with no last names, no LinkedIn links, and stylized avatars — they
          read as fabricated, which is a direct E-E-A-T trust hit. Restore
          this section ONLY when real quotes can be attributed to named users
          who have explicitly opted in. */}

      {/* ═══ CTA ═══ */}
      <section className="ab-pad" style={{ paddingTop: 40 }}><div className="ab-wrap">
        <div className="ab-cta-card">
          <div>
            <span className="ab-kicker coral" style={{ background: 'rgba(255,255,255,0.28)', color: '#fff', boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.4), inset -2px -2px 4px rgba(170,80,55,0.2)' }}><CheckCircle size={12} /> Ready when you are</span>
            <h2 style={{ marginTop: 20 }}>Initialize <em>your search.</em></h2>
            <p>Browse open {brand.niche.short} roles by state, scope, and care setting — or open a direct conduit with our team to talk through a role you&apos;ve had your eye on.</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
              <Link href="/jobs" className="ab-btn ab-btn-dark">Browse all jobs</Link>
            </div>
          </div>
          <div className="ab-cta-visual"><div className="circle-big" /></div>
        </div>
      </div></section>
    </div>
  );
}

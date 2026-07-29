import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   CategoryHero — Layout 5: Oversized type / asymmetric collage
   Fonts: Lora (heading), Inter (body/ui)
   ═══════════════════════════════════════════════════════════════ */

interface CategoryHeroProps {
  /** Category background color (from the watercolor asset) */
  bgColor: string;
  /** Watercolor hero image path */
  heroImage: string;
  /** Alt text for the hero image */
  heroAlt: string;
  /** Live badge text, e.g. "395 live roles · updated 4 min ago" */
  badgeText: string;
  /** Breadcrumb trail labels */
  breadcrumbs: string[];
  /** Category index label, e.g. "№ 04 / 26" */
  indexLabel?: string;
  /** Line 1 of the oversized heading */
  headlineLine1: string;
  /** Line 2 of the oversized heading */
  headlineLine2: string;
  /** Italic sub-line below the big type */
  headlineSub: string;
  /** Floating tag on the photo — bold title */
  photoTagTitle?: string;
  /** Floating tag on the photo — body text */
  photoTagBody?: string;
  /** Stats array for the footer row */
  stats: { value: string; label: string }[];
  /** Description paragraph */
  description: string;
  /** Primary CTA */
  ctaLabel: string;
  ctaHref: string;
  /** Secondary CTA */
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
}

// (An `isDark(hex)` luminance helper used to sit here with no call site —
// removed alongside the dead-prop fix below. bgColor now only ever feeds the
// --cat-color custom property, and nothing branches on its luminance.)

/**
 * Trailing "· updated <something>" segment of a badge string.
 * `[^·]*$` so only the last segment is considered — the count segment ahead of
 * it is never touched.
 */
const FRESHNESS_SEGMENT = /\s*·\s*updated\s+([^·]*?)\s*$/i;

/**
 * A freshness claim anchored to a calendar date, e.g. "Jul 12" — the form
 * formatStatsBadge() emits for a stats row it did NOT recompute today. A date
 * stays true no matter how long the HTML is cached.
 */
const DATED_FRESHNESS = /^[A-Za-z]{3,9}\.?\s+\d{1,2}(,\s*\d{4})?$/;

/**
 * Drop a freshness claim this component cannot stand behind.
 *
 * WHY (P2 #15's hole): rendering `badgeText` made ~30 previously-dead strings
 * visible, and only the two pSEO templates derive theirs through
 * formatStatsBadge(); 26 app/ routes hardcode "· updated today" and
 * category-landing-template hardcodes "· updated daily". Every one of those
 * routes is `revalidate = 3600` ISR, so on the long tail (/jobs/city/[slug]
 * alone is 4,135 pages) Next serves stale-while-revalidate HTML baked days or
 * weeks earlier — HTML that would assert it was updated today. That is the
 * precise false-freshness claim formatStatsBadge exists to prevent, and a
 * relative claim cannot survive HTML caching even when the caller DID derive
 * it, because the render date is baked in with it.
 *
 * So the rule is a whitelist, not a blacklist: a freshness segment survives
 * only when it names a date. Anything relative ("today", "daily", "4 min ago")
 * is dropped and the count — the informative half — still renders. Fixing this
 * inside the component keeps it out of 27 foreign files that were not handed
 * over, and it holds for call sites added later.
 */
export function stripUnverifiableFreshness(badgeText: string): string {
  const match = badgeText.match(FRESHNESS_SEGMENT);
  if (!match) return badgeText;
  if (DATED_FRESHNESS.test(match[1])) return badgeText;
  return badgeText.slice(0, match.index).trimEnd();
}

/**
 * The pulsing dot reads as a live-inventory indicator, so it is gated on the
 * badge actually making one. `badgeText="Nationwide"` (/jobs/locations) and
 * `badgeText="Job Alerts"` (/job-alerts) state no inventory and get the pill
 * without the dot.
 */
const claimsLiveInventory = (badgeText: string): boolean => /\blive\b/i.test(badgeText);

export default function CategoryHero({
  bgColor,
  heroImage,
  heroAlt,
  badgeText,
  breadcrumbs,
  indexLabel,
  headlineLine1,
  headlineLine2,
  headlineSub,
  photoTagTitle,
  photoTagBody,
  stats,
  description,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
}: CategoryHeroProps) {
  // Asymmetric coloring: cream bg, category color on photo + decorative circle
  const ink       = '#1f1a17';
  const inkSoft   = '#3d342d';
  const rule      = 'rgba(31,26,23,.16)';
  const teal      = '#BE185D';
  const tealDeep  = '#9D174D';

  // See stripUnverifiableFreshness above: the count survives, an unverifiable
  // freshness claim does not.
  const badge = stripUnverifiableFreshness(badgeText ?? '');

  return (
    <section className="cath5" style={{ background: '#faf6ef', padding: '48px 56px 0', position: 'relative', overflow: 'hidden' }}>
      {/* ── Decorative swatch circles ── */}
      <div className="cath5-swatch" />

      <div style={{ position: 'relative' }}>
        {/* ── Row 1: live-inventory pill · breadcrumb trail · index label ──
            `badgeText` (required) and `indexLabel` were destructured but never
            rendered, so all ~30 call sites built a badge string and the
            component silently discarded it. The .cath5-row1 row, the
            .cath5-badge pill and the .cath5-dot indicator below were authored
            for exactly this slot. Everything here is server-rendered from
            props, so restoring it costs no layout shift. Only the two pSEO
            templates derive freshness (formatStatsBadge); the rest hardcode it,
            hence the stripUnverifiableFreshness() guard above.

            The breadcrumb trail keeps its own contract: BreadcrumbSchema emits
            the JSON-LD, this renders the same hierarchy in the DOM so users can
            orient themselves (WCAG 2.4.8). The prop is `string[]` of labels
            only, so these are spans, not links; the last item carries
            aria-current="page". Callers that render their own linked breadcrumb
            band pass [] and only the pill shows. */}
        {(badge || indexLabel || (breadcrumbs && breadcrumbs.length > 0)) && (
          <div className="cath5-row1">
            {badge && (
              <span className="cath5-badge">
                {claimsLiveInventory(badge) && <span className="cath5-dot" aria-hidden="true" />}
                {badge}
              </span>
            )}
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="cath5-crumbs-slot">
                <ol className="cath5-crumbs" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap' }}>
                  {breadcrumbs.map((label, i) => {
                    const isLast = i === breadcrumbs.length - 1;
                    return (
                      <li key={`${label}-${i}`}>
                        <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'cath5-crumb-now' : undefined}>
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
            {indexLabel && <span className="cath5-index">{indexLabel}</span>}
          </div>
        )}
        {/* ── STAGE: Oversized type + photo ── */}
        <div className="cath5-stage">
          <h1 className="cath5-h1">
            {headlineLine1}<br />
            {headlineLine2}
            <span className="cath5-h1-sub">
              <em>{headlineSub}</em>
            </span>
          </h1>
          <div className="cath5-photo">
            <Image
              src={heroImage}
              alt={heroAlt}
              width={560}
              height={560}
              priority
              style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center bottom', display: 'block' }}
            />
            {/* Same defect as the badge: both photo-tag props were
                destructured and dropped while .cath5-photo-tag sat unused in
                the stylesheet. No caller passes them today, so this renders
                nothing until one does. */}
            {(photoTagTitle || photoTagBody) && (
              <div className="cath5-photo-tag">
                {photoTagTitle && <b>{photoTagTitle}</b>}
                {photoTagBody}
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER: Stats+Description left | CTAs under image ── */}
        <div className="cath5-footer">
          <div className="cath5-footer-left">
            <div className="cath5-stats">
              {stats.map((s, i) => (
                <div key={i}>
                  {s.value}
                  <small>{s.label}</small>
                </div>
              ))}
            </div>
            <p className="cath5-deck">{description}</p>
          </div>
          <div className="cath5-ctas">
            <Link href={ctaHref} className="cat-cta-primary" style={{
              padding: '14px 32px', borderRadius: '999px', fontWeight: 700, fontSize: '14px',
              background: '#BE185D', color: '#fff', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              boxShadow: '4px 4px 12px rgba(190,24,93,0.2)',
            }}>
              {ctaLabel} <ArrowRight size={16} />
            </Link>
            {secondaryCtaLabel && secondaryCtaHref && (
              <Link href={secondaryCtaHref} className="cat-cta-primary" style={{
                padding: '14px 28px', borderRadius: '999px', fontWeight: 700, fontSize: '14px',
                background: 'rgba(255,255,255,0.8)', color: '#1A2E35', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                border: '1px solid rgba(0,0,0,0.08)',
                boxShadow: '4px 4px 12px rgba(0,0,0,0.06)',
                backdropFilter: 'blur(8px)',
              }}>
                {secondaryCtaLabel} <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Scoped styles — using CSS vars from the component ── */}
      <style>{`
        .cath5 {
          --ink: ${ink};
          --ink-soft: ${inkSoft};
          --rule: ${rule};
          --teal: ${teal};
          --teal-deep: ${tealDeep};
          --cat-color: ${bgColor};
          /* .cath5-badge referenced --pill-bg / --pill-border, which nothing
             ever defined — an unresolved custom property is invalid at
             computed-value time, so the pill would have rendered with no
             background and an inherited border colour. Defined here against
             the cream stage so the glass pill reads as intended. */
          --pill-bg: rgba(255, 255, 255, .72);
          --pill-border: rgba(31, 26, 23, .12);
        }

        /* ── Decorative swatch ── */
        .cath5-swatch {
          position: absolute; inset: 0; pointer-events: none;
        }
        .cath5-swatch::before {
          content: ""; position: absolute;
          left: -80px; top: -80px;
          width: 480px; height: 480px;
          border-radius: 50%;
          background: var(--cat-color);
          opacity: 0.35;
        }
        .cath5-swatch::after {
          content: ""; position: absolute;
          right: -100px; bottom: -140px;
          width: 380px; height: 380px;
          border-radius: 50%;
          background: #d8ebe4;
          opacity: 0.35;
        }

        /* ── Row 1 ──
           Flex rather than a 3-column grid: the three slots are all
           conditional (pSEO templates pass breadcrumbs={[]} and no
           indexLabel), and with a fixed \`auto 1fr auto\` template an omitted
           slot silently shifted the next one into the wrong column. */
        .cath5-row1 {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px 16px;
          margin-bottom: 24px;
          font: 500 12px/1 'Inter', var(--font-inter), system-ui, sans-serif;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .cath5-crumbs-slot {
          flex: 1 1 auto;
          display: flex;
          justify-content: center;
          min-width: 0;
        }
        .cath5-badge {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--pill-bg);
          padding: 8px 14px; border-radius: 999px;
          border: 1px solid var(--pill-border);
          font: 500 12px/1 'Inter', var(--font-inter), system-ui, sans-serif;
          color: var(--ink-soft);
          letter-spacing: .04em;
          text-transform: none;
        }
        .cath5-dot {
          width: 7px; height: 7px; border-radius: 99px;
          background: var(--teal);
          display: inline-block;
          animation: cath5-pulse 1.6s ease-in-out infinite;
        }
        @keyframes cath5-pulse {
          0%, 100% { opacity: .4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        /* The pulse is decorative and runs indefinitely, and it now ships on
           ~30 route families. app/globals.css's reduced-motion block is a
           class ALLOWLIST (.animate-*, .reveal-*, .animate-shimmer,
           .hero-gradient-text), not a universal selector, so it cannot reach
           this component-scoped class — gate it here. */
        @media (prefers-reduced-motion: reduce) {
          .cath5-dot { animation: none; opacity: 1; }
        }
        .cath5-crumbs {
          display: flex; gap: 14px;
          color: var(--ink-soft);
          opacity: 0.7;
        }
        /* Separator was \`span:not(:last-child)\`, but every span is the only
           child of its own <li>, so :last-child matched all of them and no
           separator ever rendered. Hang it off the <li> instead. */
        .cath5-crumbs li:not(:last-child)::after {
          content: "·"; margin-left: 14px;
        }
        .cath5-crumb-now { color: var(--ink) !important; opacity: 1; }
        .cath5-index {
          font: 500 12px/1 'Inter', var(--font-inter), monospace;
          letter-spacing: .1em;
          color: var(--ink-soft);
        }

        /* ── Stage ── */
        .cath5-stage {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 24px;
          align-items: end;
        }
        .cath5-h1 {
          font-family: var(--font-lora), 'Lora', Georgia, serif;
          font-weight: 700;
          font-size: clamp(72px, 12vw, 160px);
          line-height: .88;
          letter-spacing: -0.04em;
          margin: 0;
          color: var(--ink);
        }
        .cath5-h1-sub {
          display: block;
          font-family: var(--font-lora), 'Lora', Georgia, serif;
          font-style: italic;
          font-size: clamp(36px, 5.5vw, 72px);
          color: var(--teal);
          font-weight: 400;
          margin-top: -4px;
          letter-spacing: -0.02em;
        }
        .cath5-h1-sub em {
          font-family: var(--font-lora), 'Lora', Georgia, serif;
          font-style: italic;
          color: var(--teal);
        }
        .cath5-photo {
          position: relative;
          overflow: hidden;
          align-self: end;
          height: clamp(260px, 28vw, 380px);
          background: var(--cat-color);
        }
        .cath5-photo-tag {
          position: absolute;
          left: 16px; bottom: 16px;
          background: rgba(255,255,255,.92);
          padding: 10px 14px;
          border-radius: 10px;
          font: 500 12px/1.35 'Inter', var(--font-inter), sans-serif;
          color: #1f1a17;
          max-width: 220px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .cath5-photo-tag b {
          color: var(--teal);
          display: block;
          font-weight: 700;
          font-size: 12px;
          margin-bottom: 3px;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        /* ── Footer ── */
        .cath5-footer {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 24px;
          align-items: center;
          margin-top: 32px;
          padding: 24px 0 40px;
          border-top: 1px solid var(--rule);
        }
        .cath5-footer-left {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 36px;
          align-items: center;
        }
        .cath5-stats {
          display: flex; gap: 32px;
          font-family: var(--font-lora), 'Lora', Georgia, serif;
        }
        .cath5-stats > div {
          font-size: 22px;
          line-height: 1;
          font-weight: 600;
          color: var(--ink);
        }
        .cath5-stats > div small {
          display: block;
          font-family: 'Inter', var(--font-inter), sans-serif;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--ink-soft);
          margin-top: 6px;
          font-weight: 500;
        }
        .cath5-deck {
          font: 400 14px/1.55 'Inter', var(--font-inter), sans-serif;
          color: var(--ink-soft);
          max-width: 54ch;
          margin: 0;
        }
        .cath5-ctas {
          display: flex; gap: 10px;
          justify-content: center;
          align-self: center;
        }
        .cat-cta-primary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease, background 0.25s ease;
        }
        .cat-cta-primary:first-child:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important;
          filter: brightness(1.08);
        }
        .cat-cta-primary:nth-child(2):hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important;
          background: rgba(255,255,255,0.95) !important;
          border-color: rgba(190,24,93,0.3) !important;
        }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .cath5 { padding: 32px 24px 0 !important; }
          .cath5-row1 { gap: 10px 12px; }
          .cath5-crumbs-slot { flex-basis: 100%; justify-content: flex-start; }
          .cath5-index { display: none; }
          .cath5-stage { grid-template-columns: 1fr; gap: 16px; }
          .cath5-h1 { font-size: clamp(56px, 15vw, 96px); }
          .cath5-h1-sub { font-size: clamp(28px, 7vw, 44px); }
          .cath5-photo { height: 240px; }
          .cath5-footer {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .cath5-stats { flex-wrap: wrap; gap: 20px; }
          .cath5-deck { justify-self: start; }
        }
      `}</style>
    </section>
  );
}

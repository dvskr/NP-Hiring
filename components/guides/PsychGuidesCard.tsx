import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { psychEditions } from '@/config/psych-editions';
import GuideCover, { CoverStack } from '@/components/guides/GuideCover';
import { BERRY, CLAY_BODY, OXBLOOD } from '@/components/guides/styles';
import { BUNDLES, GUIDES, PSYCH_GUIDE_SLUGS } from '@/lib/guides/catalog';
import { isSisterBoardSpecialty } from '@/lib/sister-board';

/**
 * The psych editions on the sister board's specialty pages (owner decision
 * 2026-11-26): the category landing and its state and city pages, the readers
 * those guides are written for. Each link goes to this store's own product
 * page, where the guide is claimed or bought, never to another site.
 *
 *   sidebar  the first card in the listings sidebar, so a desktop shows it
 *            beside the first jobs; hidden under the lg breakpoint, where the
 *            sidebar falls below every listing
 *   inline   a compact card at the top of the listings, under the hero, for
 *            the phones and tablets that hide the sidebar card
 *
 * The page renders both and CSS shows one. Clay with the lavender tint of the
 * sister board's blocks (the job pages are clay). No price and no phase copy:
 * these pages re-render on their own clock, so the price stays on the store's
 * pages, which take it from guidePriceCopy. The card never names the sister
 * board, which keeps it clear of the job pages' donor copy guard.
 */

interface PsychGuidesCardProps {
    /** The page's specialty slug; the card renders only for the sister board's specialty. */
    readonly categorySlug: string;
    readonly placement: 'sidebar' | 'inline';
}

const LIBRARY = BUNDLES['psych-library'];
const LIBRARY_HREF = `/guides/${LIBRARY.slug}`;

/** The button's fill is inline, so its hover darkens it with a filter (as GuidePromo's does). */
const CARD_CSS = `
.psych-card-row { transition: background 0.2s ease; }
.psych-card-row:hover { background: rgba(255,255,255,0.7); }
.psych-card-cta { transition: transform 0.2s ease, filter 0.2s ease; }
.psych-card-cta:hover { transform: translateY(-2px); filter: brightness(0.88); }
.psych-card-row:focus-visible, .psych-card-cta:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .psych-card-row, .psych-card-cta { transition: none; }
  .psych-card-cta:hover { transform: none; }
}
`;

/** One copy of the hover rules per page (React hoists and dedupes it). */
function CardStyles() {
    return <style href="psych-guides-card" precedence="default">{CARD_CSS}</style>;
}

const lavenderClay: CSSProperties = {
    borderRadius: '20px',
    background: 'linear-gradient(145deg, #F7F3FC, #EFE8F7)',
    border: '2px solid rgba(122,28,43,0.12)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

const eyebrow: CSSProperties = {
    margin: 0,
    fontSize: '11.5px',
    fontWeight: 800,
    color: BERRY,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
};

const headingStyle: CSSProperties = { fontSize: '18px', fontWeight: 700, color: OXBLOOD, margin: '4px 0 8px', lineHeight: 1.25 };
const bodyStyle: CSSProperties = { fontSize: '13px', color: CLAY_BODY, lineHeight: 1.55, margin: 0 };

const ctaStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 16px',
    borderRadius: '10px',
    fontWeight: 700,
    fontSize: '13px',
    background: BERRY,
    color: '#fff',
    textDecoration: 'none',
    textAlign: 'center',
};

function SidebarCard() {
    const { card } = psychEditions;
    const headingId = 'psych-guides-sidebar-heading';
    return (
        <aside aria-labelledby={headingId} className="hidden lg:block" style={{ ...lavenderClay, padding: '22px 20px', marginBottom: '20px' }}>
            <CardStyles />
            <p style={eyebrow}>{card.eyebrow}</p>
            <h3 id={headingId} className="font-lora" style={headingStyle}>{card.heading}</h3>
            <p style={bodyStyle}>{card.body}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 14px', display: 'grid', gap: '2px' }}>
                {PSYCH_GUIDE_SLUGS.map((slug) => (
                    <li key={slug}>
                        <Link
                            href={`/guides/${slug}`}
                            className="psych-card-row"
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px', borderRadius: '10px', textDecoration: 'none' }}
                        >
                            <GuideCover slug={slug} width={28} />
                            <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: '#1A2E35', lineHeight: 1.35 }}>{GUIDES[slug].title}</span>
                        </Link>
                    </li>
                ))}
            </ul>
            <Link href={LIBRARY_HREF} className="psych-card-cta" style={ctaStyle}>
                {card.action} <ArrowRight size={15} aria-hidden="true" />
            </Link>
        </aside>
    );
}

function InlineCard() {
    const { card } = psychEditions;
    const headingId = 'psych-guides-inline-heading';
    return (
        <aside aria-labelledby={headingId} className="lg:hidden" style={{ ...lavenderClay, padding: '18px', marginBottom: '24px' }}>
            <CardStyles />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
                <CoverStack guides={LIBRARY.guides} width={40} />
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <p style={eyebrow}>{card.eyebrow}</p>
                    <h3 id={headingId} className="font-lora" style={{ ...headingStyle, margin: '4px 0 6px' }}>{card.heading}</h3>
                    <p style={bodyStyle}>{card.body}</p>
                </div>
            </div>
            <Link href={LIBRARY_HREF} className="psych-card-cta" style={{ ...ctaStyle, marginTop: '14px' }}>
                {card.inlineAction} <ArrowRight size={15} aria-hidden="true" />
            </Link>
        </aside>
    );
}

export default function PsychGuidesCard({ categorySlug, placement }: PsychGuidesCardProps) {
    if (!isSisterBoardSpecialty(categorySlug)) return null;
    return placement === 'sidebar' ? <SidebarCard /> : <InlineCard />;
}

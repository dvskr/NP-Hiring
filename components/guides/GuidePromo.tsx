import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import GuideCover, { CoverStack } from '@/components/guides/GuideCover';
import { BERRY, CLAY_BODY, CLAY_INK, OXBLOOD, TITLE_INK, MUTED, clayCard } from '@/components/guides/styles';
import { stickerFill } from '@/lib/design/sticker-css';
import { BUNDLES, GUIDES, isGuideSlug, totalPages, type GuideSlug, type Product, type ProductSlug } from '@/lib/guides/catalog';

/**
 * Links to the guides store from the pages where a guide answers what the
 * reader is already doing there: the 1099 calculator points at the
 * negotiation guide, the salary guide at the compensation report, and so on.
 * Titles and page counts come from the catalog.
 *
 * No price and no phase copy: these cards sit on pages that are rebuilt
 * daily or not at all, so a price on them could still say "free" after the
 * free period ends. The price lives on /guides and its product pages, which
 * re-render hourly and take it from guidePriceCopy.
 *
 * No hooks, so it renders in server and client components alike.
 */

function productFor(slug: ProductSlug): Product {
    return isGuideSlug(slug) ? GUIDES[slug] : BUNDLES[slug];
}

/** "PDF, 31 pages" or "4 guides, 141 pages". */
function factsLine(product: Product): string {
    return product.kind === 'guide'
        ? `PDF, ${product.pages} pages`
        : `${product.guides.length} guides, ${totalPages(product)} pages`;
}

const PROMO_CSS = `
.guide-promo-cta { transition: transform 0.2s ease, filter 0.2s ease, background 0.2s ease; }
.guide-promo-cta:hover { transform: translateY(-2px); filter: brightness(1.05); }
.guide-promo-cta:focus-visible, .guide-shelf-row:focus-visible, .guide-shelf-all:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
.guide-promo-sticker .guide-promo-cta:hover { filter: none; background: #9D174D; }
.guide-shelf-row { transition: background 0.2s ease; }
.guide-shelf-row:hover { background: #FDF2F8; }
.guide-shelf-all:hover { text-decoration: underline; text-underline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .guide-promo-cta, .guide-shelf-row { transition: none; }
  .guide-promo-cta:hover { transform: none; }
}
`;

/** One copy of the hover rules per page, however many promos render (React hoists and dedupes it). */
function PromoStyles() {
    return <style href="guide-promo" precedence="default">{PROMO_CSS}</style>;
}

const clayCta: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    borderRadius: '12px',
    background: 'linear-gradient(145deg, #BE185D, #9D174D)',
    color: '#FFFFFF',
    fontSize: '14px',
    fontWeight: 700,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    boxShadow: '4px 4px 12px rgba(190,24,93,0.25), inset 1px 1px 2px rgba(255,255,255,0.15)',
};

const stickerCta: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '11px 20px',
    background: BERRY,
    color: '#FFFFFF',
    fontSize: '12.5px',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    border: `2px solid ${OXBLOOD}`,
    boxShadow: `4px 4px 0 ${OXBLOOD}`,
};

const eyebrowStyle: CSSProperties = {
    margin: 0,
    fontSize: '11.5px',
    fontWeight: 800,
    color: BERRY,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
};

interface GuidePromoProps {
    readonly slug: ProductSlug;
    /** The reader's situation on this page, e.g. "Weighing an offer?" */
    readonly heading: string;
    /** What the guide gives them; defaults to the product subtitle. */
    readonly pitch?: string;
    readonly headingLevel?: 'h2' | 'h3';
    /** Clay on the clay pages (the default), sticker on the sticker pages such as /resources. */
    readonly variant?: 'clay' | 'sticker';
    /** Outer spacing and width, set by the page. */
    readonly style?: CSSProperties;
}

/** A single guide or bundle, framed by the page's context. */
export default function GuidePromo({ slug, heading, pitch, headingLevel = 'h2', variant = 'clay', style }: GuidePromoProps) {
    const product = productFor(slug);
    const Heading = headingLevel;
    const label = product.kind === 'guide' ? 'Career guide' : 'Guide bundle';
    const action = product.kind === 'guide' ? 'See the guide' : 'See the bundle';
    const sticker = variant === 'sticker';
    const frame: CSSProperties = sticker
        ? { background: '#FFFFFF', border: `2px solid ${OXBLOOD}`, boxShadow: `5px 5px 0 ${OXBLOOD}` }
        : clayCard;
    return (
        <aside
            aria-label={`${label}: ${product.title}`}
            className={sticker ? 'guide-promo guide-promo-sticker' : 'guide-promo'}
            style={{ ...frame, padding: '22px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px', textAlign: 'left', ...style }}
        >
            <PromoStyles />
            <div style={{ flexShrink: 0 }}>
                {product.kind === 'guide'
                    ? <GuideCover slug={product.slug} width={68} />
                    : <CoverStack guides={product.guides} width={52} />}
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sticker
                    ? <span className="stk-chip" style={{ background: stickerFill(1), alignSelf: 'flex-start' }}>{label}</span>
                    : <p style={eyebrowStyle}>{label}</p>}
                <Heading className="font-heading" style={{ margin: 0, fontSize: sticker ? '18px' : '19px', fontWeight: sticker ? 700 : 800, color: sticker ? TITLE_INK : CLAY_INK, lineHeight: 1.25 }}>
                    {heading}
                </Heading>
                <p style={{ margin: 0, fontSize: sticker ? '13px' : '14px', color: sticker ? MUTED : CLAY_BODY, lineHeight: 1.55 }}>
                    <strong style={{ color: sticker ? TITLE_INK : CLAY_INK }}>{product.title}</strong>
                    {'. '}
                    {pitch ?? product.subtitle}
                </p>
                <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: sticker ? MUTED : CLAY_BODY }}>{factsLine(product)}</p>
            </div>
            <Link href={`/guides/${product.slug}`} className="guide-promo-cta" style={sticker ? stickerCta : clayCta} aria-label={`${action}: ${product.title}`}>
                {action}
                <ArrowRight size={16} aria-hidden="true" />
            </Link>
        </aside>
    );
}

/** The guides that matter during a job search, in the order a search runs. */
const SHELF_GUIDES: readonly GuideSlug[] = ['compensation-report', 'interview-prep-pack', 'negotiate-like-an-np', 'first-year-playbook'];

/** A short list of guides for a narrow column, such as the job seeker dashboard rail. */
export function GuideShelf({ guides = SHELF_GUIDES }: { readonly guides?: readonly GuideSlug[] }) {
    return (
        <aside aria-labelledby="guide-shelf-heading" style={{ ...clayCard, padding: '20px 18px' }}>
            <PromoStyles />
            <p style={eyebrowStyle}>Career guides</p>
            <h2 id="guide-shelf-heading" className="font-heading" style={{ margin: '4px 0 10px', fontSize: '16px', fontWeight: 800, color: CLAY_INK }}>
                Go into your search prepared
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '2px' }}>
                {guides.map((slug) => {
                    const guide = GUIDES[slug];
                    return (
                        <li key={slug}>
                            <Link
                                href={`/guides/${slug}`}
                                className="guide-shelf-row"
                                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', borderRadius: '12px', textDecoration: 'none' }}
                            >
                                <GuideCover slug={slug} width={34} />
                                <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: CLAY_INK, lineHeight: 1.35 }}>{guide.title}</span>
                                <span style={{ fontSize: '12px', fontWeight: 700, color: BERRY, whiteSpace: 'nowrap' }}>{guide.pages} pages</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
            <Link href="/guides" className="guide-shelf-all" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '13px', fontWeight: 700, color: BERRY, textDecoration: 'none' }}>
                All guides and bundles <ArrowRight size={14} aria-hidden="true" />
            </Link>
        </aside>
    );
}

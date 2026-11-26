import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, BookOpen, Check, Download, FileText, Users } from 'lucide-react';
import { brand } from '@/config/brand';
import { psychEditions } from '@/config/psych-editions';
import Breadcrumbs from '@/components/Breadcrumbs';
import { StickerHead, StickerStage, StickerStyles } from '@/components/sticker';
import GuideAction, { addOnOffer } from '@/components/guides/GuideAction';
import GuideCover, { COVER_PALETTES, CoverStack } from '@/components/guides/GuideCover';
import GuidePrice from '@/components/guides/GuidePrice';
import GuideSchema from '@/components/guides/GuideSchema';
import { GUIDES_CSS } from '@/components/guides/styles';
import { stickerFill } from '@/lib/design/sticker-css';
import {
    GUIDES,
    allProducts,
    bundlesContaining,
    getProduct,
    totalPages,
    type Bundle,
    type Guide,
    type Product,
} from '@/lib/guides/catalog';
import { guidePhase, guidePriceCopy, type GuidePhase, type GuidePriceCopy } from '@/lib/guides/phase';
import { productCanonicalUrl, productPageUrl } from '@/lib/guides/canonical';
import { guideOgImageUrl, productOgCard } from '@/lib/guides/og';
import { productJsonLd } from '@/lib/guides/schema';
import { guidesFinePrint, guidesMetaSentence } from '../guides-copy';

/**
 * /guides/<slug>: one guide or bundle. Its chapters (or the guides in the
 * bundle), who it is for, the bundles that contain the guide, the price
 * block and action of the phase (lib/guides/phase.ts#guidePhase): the claim
 * form while checkout is not set up, checkout with the add-on checkbox once
 * it is, and the Product JSON-LD with the same offer. Reads the phase per
 * render and re-renders hourly, like /guides.
 *
 * A psych edition (the sister board's guide, sold here) says who wrote it,
 * and its canonical is the sister board's page for the same guide
 * (lib/guides/canonical.ts), while its offer stays this store's.
 */
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
    return allProducts().map((product) => ({ slug: product.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

function kindLabel(product: Product): string {
    const guide = product.kind === 'guide';
    if (product.edition === 'psych') return guide ? psychEditions.labels.guideKind : psychEditions.labels.bundleKind;
    return guide ? `${brand.niche.short} Career Guide` : `${brand.niche.short} Guide Bundle`;
}

/** The chip over the title: a guide's subject, a psych edition's edition, a bundle's kind. */
function chipLabel(product: Product): string {
    if (product.kind === 'bundle') return kindLabel(product);
    return product.edition === 'psych' ? psychEditions.labels.edition : COVER_PALETTES[product.slug].label;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const product = getProduct(slug);
    if (!product) return {};
    const ogImage = guideOgImageUrl(productOgCard(product));
    return {
        title: `${product.title}: ${kindLabel(product)}`,
        description: `${product.summary} ${guidesMetaSentence(guidePhase())}`,
        openGraph: {
            title: product.title,
            description: product.summary,
            url: productPageUrl(product),
            images: [{ url: ogImage, width: 1200, height: 630, alt: product.title }],
        },
        twitter: { card: 'summary_large_image', images: [ogImage] },
        alternates: { canonical: productCanonicalUrl(product) },
    };
}

function Facts({ product }: { readonly product: Product }) {
    const count = product.kind === 'guide' ? 1 : product.guides.length;
    return (
        <ul className="gd-pill-row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="gd-pill"><FileText size={13} aria-hidden="true" /> {count === 1 ? 'PDF' : `${count} PDFs`}, {totalPages(product)} pages</li>
            <li className="gd-pill"><Download size={13} aria-hidden="true" /> Instant download</li>
        </ul>
    );
}

function GuideContents({ guide }: { readonly guide: Guide }) {
    return (
        <ol className="gd-chapters">
            {guide.contents.map((chapter, index) => (
                <li key={chapter}>
                    <span className="gd-chapter-no">{String(index + 1).padStart(2, '0')}</span>
                    {chapter}
                </li>
            ))}
        </ol>
    );
}

function BundleContents({ bundle }: { readonly bundle: Bundle }) {
    return (
        <div style={{ display: 'grid', gap: '18px' }}>
            {bundle.guides.map((slug) => {
                const guide = GUIDES[slug];
                return (
                    <div key={slug} className="stk-card stk-static gd-row-card">
                        <div className="gd-cover-wrap"><GuideCover slug={slug} width={72} /></div>
                        <div style={{ minWidth: 0 }}>
                            <h3 className="stk-title font-heading" style={{ fontSize: '16px', margin: '0 0 4px' }}>{guide.title}</h3>
                            <p className="stk-desc" style={{ fontSize: '13px', margin: '0 0 8px' }}>{guide.summary}</p>
                            <p className="gd-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center' }}>
                                {guide.pages} pages
                                <Link href={`/guides/${slug}`} className="stk-link" style={{ fontSize: '11px' }}>See chapters</Link>
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function BundleUpsell({ guide, phase }: { readonly guide: Guide; readonly phase: GuidePhase }) {
    const bundles = bundlesContaining(guide.slug);
    if (!bundles.length) return null;
    return (
        <StickerStage variant="peach" aria-labelledby="bundles-heading" maxWidth={1000}>
            <StickerHead eyebrow="Bundles" title="This guide is also in" id="bundles-heading" />
            <div className="stk-grid stk-cols-3">
                {bundles.map((bundle, index) => (
                    <Link key={bundle.slug} href={`/guides/${bundle.slug}`} className="stk-card" style={{ gap: '14px' }}>
                        <span className="stk-chip" style={{ background: stickerFill(index) }}>{bundle.guides.length} guides</span>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <CoverStack guides={bundle.guides} width={52} />
                        </div>
                        <h3 className="stk-title font-heading" style={{ margin: 0 }}>{bundle.title}</h3>
                        <p className="stk-desc" style={{ margin: 0 }}>{bundle.subtitle}</p>
                        <div style={{ marginTop: 'auto' }}>
                            <GuidePrice copy={guidePriceCopy(bundle, phase)} size="sm" withNote={false} />
                        </div>
                    </Link>
                ))}
            </div>
        </StickerStage>
    );
}

/** What a reader gets with any product, in both phases. */
const WITH_EVERY_GUIDE: readonly string[] = ['Read on any device or print', 'The latest edition on every download', 'No account needed'];

function Aside({ product, copy }: { readonly product: Product; readonly copy: GuidePriceCopy }) {
    const lines = copy.phase === 'paid' ? ['Pay once, keep it', ...WITH_EVERY_GUIDE] : WITH_EVERY_GUIDE;
    return (
        <aside className="stk-card stk-static" style={{ gap: '18px' }}>
            <div>
                <h2 className="stk-title font-heading" style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={16} aria-hidden="true" style={{ color: '#BE185D' }} /> Who it is for
                </h2>
                <p className="stk-desc" style={{ fontSize: '13.5px', margin: 0 }}>{product.audience}</p>
            </div>
            <div>
                <h2 className="stk-title font-heading" style={{ fontSize: '16px' }}>In short</h2>
                <p className="stk-desc" style={{ fontSize: '13.5px', margin: 0 }}>{product.summary}</p>
            </div>
            <ul className="gd-checks">
                {lines.map((line) => (
                    <li key={line}><Check size={15} aria-hidden="true" /> {line}</li>
                ))}
            </ul>
        </aside>
    );
}

export default async function GuideProductPage({ params }: PageProps) {
    const { slug } = await params;
    const product = getProduct(slug);
    if (!product) notFound();

    // One phase read per render: the price block, the action, the add-on, the fine print and the JSON-LD switch together.
    const phase = guidePhase();
    const copy = guidePriceCopy(product, phase);
    const addOn = phase === 'paid' ? addOnOffer(product) : null;
    const finePrint = guidesFinePrint(phase);
    const isGuide = product.kind === 'guide';

    return (
        <>
            <StickerStyles />
            <style>{GUIDES_CSS}</style>
            <GuideSchema data={productJsonLd(product, phase)} />

            <div className="pseo-crumb-band">
                <Breadcrumbs items={[
                    { label: 'Home', href: '/' },
                    { label: 'Career Guides', href: '/guides' },
                    { label: product.title },
                ]} />
            </div>

            <StickerStage variant="grid" aria-labelledby="product-heading" maxWidth={1000}>
                <div className="gd-product-hero">
                    <div className="gd-product-art">
                        {isGuide
                            ? <GuideCover slug={product.slug} width={240} />
                            : <CoverStack guides={product.guides} width={product.guides.length > 4 ? 96 : 110} />}
                    </div>
                    <div className="gd-product-copy">
                        <span className="stk-chip" style={{ background: stickerFill(0) }}>{chipLabel(product)}</span>
                        <h1 id="product-heading" className="stk-h1 font-heading" style={{ fontSize: 'clamp(1.9rem, 4.2vw, 2.8rem)' }}>
                            {product.title}
                        </h1>
                        <p className="gd-product-sub">{product.subtitle}</p>
                        {product.edition === 'psych' && (
                            <p className="gd-attribution" data-sister-board="" style={{ margin: 0 }}>{psychEditions.attribution}</p>
                        )}
                        <Facts product={product} />
                        <GuidePrice copy={copy} size="lg" />
                        <div className="gd-product-action">
                            <GuideAction product={product} copy={copy} addOn={addOn} />
                        </div>
                        {finePrint && <p className="gd-fine">{finePrint}</p>}
                    </div>
                </div>
            </StickerStage>

            <StickerStage variant="cream" aria-labelledby="contents-heading" maxWidth={1000}>
                <div className="gd-split" style={{ textAlign: 'left' }}>
                    <div>
                        <p className="stk-eyebrow">
                            <BookOpen size={13} aria-hidden="true" style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
                            {isGuide ? 'What is inside' : 'Guides included'}
                        </p>
                        <h2 id="contents-heading" className="stk-h2 font-heading" style={{ marginBottom: '22px' }}>
                            {isGuide ? `${product.contents.length} chapters, ${product.pages} pages` : `${product.guides.length} guides, ${totalPages(product)} pages`}
                        </h2>
                        {isGuide ? <GuideContents guide={product} /> : <BundleContents bundle={product} />}
                    </div>
                    <Aside product={product} copy={copy} />
                </div>
            </StickerStage>

            {isGuide ? <BundleUpsell guide={product} phase={phase} /> : null}

            <StickerStage variant="blush" maxWidth={760}>
                <p style={{ fontSize: '15px', color: '#5A4A42', margin: '0 0 14px', textAlign: 'center' }}>
                    Questions about a guide? Email{' '}
                    <a href={`mailto:${brand.email.support}`} className="stk-link" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '15px' }}>{brand.email.support}</a>
                </p>
                <p style={{ margin: 0, textAlign: 'center' }}>
                    <Link href="/guides" className="stk-link">
                        Browse every guide and bundle <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                </p>
            </StickerStage>
        </>
    );
}

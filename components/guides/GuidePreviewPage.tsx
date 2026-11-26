import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarDays, Check, Download, FileText, Layers, Users } from 'lucide-react';
import { brand } from '@/config/brand';
import Breadcrumbs from '@/components/Breadcrumbs';
import { StickerStage, StickerStyles } from '@/components/sticker';
import GuideAction from '@/components/guides/GuideAction';
import type { AddOnOffer } from '@/components/guides/BuyButton';
import GuideCover, { COVER_PALETTES } from '@/components/guides/GuideCover';
import GuideExcerpt from '@/components/guides/GuideExcerpt';
import GuideFaq from '@/components/guides/GuideFaq';
import GuideKeyFigures from '@/components/guides/GuideKeyFigures';
import GuidePrice from '@/components/guides/GuidePrice';
import GuideSchema from '@/components/guides/GuideSchema';
import GuideToc from '@/components/guides/GuideToc';
import { BundleUpsell, productPromises } from '@/components/guides/ProductBlocks';
import { GUIDE_PREVIEW_CSS } from '@/components/guides/preview-styles';
import { GUIDES_CSS } from '@/components/guides/styles';
import { stickerFill } from '@/lib/design/sticker-css';
import { GUIDES, OWN_GUIDE_SLUGS, type Guide } from '@/lib/guides/catalog';
import { parseExcerpt } from '@/lib/guides/excerpt';
import { guidePriceCopy, type GuidePhase, type GuidePriceCopy } from '@/lib/guides/phase';
import { previewChapterCount, previewSummary, type GuidePreview } from '@/lib/guides/previews';
import { previewFaqJsonLd, previewProductJsonLd } from '@/lib/guides/schema';

/**
 * The deep page for one of this board's own guides (lib/guides/previews): an
 * answer to the search that brings a reader here, the price block and the
 * action of the phase near the top, a real part of the guide to read, the
 * full table of contents, key figures with their sources, an open FAQ, and
 * the price block and action again at the end. Everything is
 * server-rendered: a crawler and a reader get the same page, and no text
 * waits on a click or a script.
 *
 * The phase (lib/guides/phase.ts) is read once by the route and handed in
 * with its price copy, so the two actions, the checkmarks, the other guides'
 * prices and the Offer markup switch together. No copy here offers the
 * guide at no cost or names a price: the price block and the action say
 * that, from guidePriceCopy.
 */

export const GUIDE_EXCERPT_ID = 'guide-excerpt';
export const GUIDE_BUY_ID = 'buy-guide';

interface GuidePreviewPageProps {
    readonly guide: Guide;
    readonly preview: GuidePreview;
    readonly phase: GuidePhase;
    /** guidePriceCopy(guide, phase), decided by the route. */
    readonly copy: GuidePriceCopy;
    /** The paid phase's add-on checkbox; null while the guides are free. */
    readonly addOn: AddOnOffer | null;
    /** The line under each action, or null while the guides are free. */
    readonly finePrint: string | null;
}

/** "2026-10-24" -> "October 24, 2026", read in UTC so every host prints the same day. */
export function editionDateLabel(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function editionLine(preview: GuidePreview): string {
    return `${preview.edition.name} edition, updated ${editionDateLabel(preview.edition.updated)}`;
}

function Hero({ guide, preview, copy, addOn, finePrint, chapters }: GuidePreviewPageProps & { readonly chapters: number }) {
    return (
        <StickerStage variant="grid" aria-labelledby="product-heading" maxWidth={1000}>
            <div className="gd-product-hero">
                <div className="gd-product-art">
                    <GuideCover slug={guide.slug} width={240} />
                </div>
                <div className="gd-product-copy">
                    <span className="stk-chip" style={{ background: stickerFill(0) }}>{COVER_PALETTES[guide.slug].label}</span>
                    <h1 id="product-heading" className="stk-h1 font-heading" style={{ fontSize: 'clamp(1.7rem, 3.6vw, 2.4rem)' }}>
                        {preview.h1}
                    </h1>
                    <p className="gd-intro">{preview.intro}</p>
                    <ul className="gd-pill-row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        <li className="gd-pill"><FileText size={13} aria-hidden="true" /> {`PDF, ${guide.pages} pages`}</li>
                        <li className="gd-pill"><Layers size={13} aria-hidden="true" /> {`${chapters} chapters`}</li>
                        <li className="gd-pill"><CalendarDays size={13} aria-hidden="true" /> {editionLine(preview)}</li>
                        <li className="gd-pill"><Download size={13} aria-hidden="true" /> Instant download</li>
                    </ul>
                    <GuidePrice copy={copy} size="lg" />
                    <div className="gd-product-action">
                        <GuideAction product={guide} copy={copy} addOn={addOn} />
                    </div>
                    {finePrint && <p className="gd-fine">{finePrint}</p>}
                </div>
            </div>
        </StickerStage>
    );
}

function Excerpt({ preview }: { readonly preview: GuidePreview }) {
    return (
        <StickerStage variant="cream" id={GUIDE_EXCERPT_ID} aria-labelledby="guide-excerpt-heading" maxWidth={1000}>
            <div className="gd-reading">
                <div className="gd-section-head">
                    <p className="stk-eyebrow">{`From the ${preview.noun}`}</p>
                    <h2 id="guide-excerpt-heading" className="stk-h2 font-heading">{preview.excerpt.heading}</h2>
                    <p className="gd-section-note">{preview.excerpt.note}</p>
                </div>
                <article className="gd-excerpt-card">
                    <GuideExcerpt blocks={parseExcerpt(preview.excerpt.body)} />
                    <p className="guide-excerpt-disclaimer">{preview.disclaimer}</p>
                </article>
                <p className="guide-bridge">
                    {preview.excerpt.bridge}{' '}
                    <a href={`#${GUIDE_BUY_ID}`}>{`Get the full ${preview.noun}`}</a>
                </p>
            </div>
        </StickerStage>
    );
}

function Contents({ guide, preview, chapters }: { readonly guide: Guide; readonly preview: GuidePreview; readonly chapters: number }) {
    return (
        <StickerStage variant="peach" aria-labelledby="guide-contents-heading" maxWidth={1000}>
            <div className="gd-section-head">
                <p className="stk-eyebrow">
                    <BookOpen size={13} aria-hidden="true" style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
                    Table of contents
                </p>
                <h2 id="guide-contents-heading" className="stk-h2 font-heading">
                    {`Inside the full ${preview.noun}: ${chapters} chapters, ${guide.pages} pages`}
                </h2>
            </div>
            <GuideToc toc={preview.toc} excerptId={GUIDE_EXCERPT_ID} />
        </StickerStage>
    );
}

function BuyAgain({ guide, preview, copy, addOn, finePrint, chapters }: GuidePreviewPageProps & { readonly chapters: number }) {
    const gets = [`PDF, ${guide.pages} pages, ${chapters} chapters`, editionLine(preview), 'Instant download', ...productPromises(copy)];
    return (
        <StickerStage variant="grid" id={GUIDE_BUY_ID} aria-labelledby="guide-buy-heading" maxWidth={1000}>
            <div className="gd-buy-card">
                <div className="gd-product-hero">
                    <div className="gd-product-art">
                        <GuideCover slug={guide.slug} width={170} />
                    </div>
                    <div className="gd-product-copy" style={{ gap: '14px' }}>
                        <p className="stk-eyebrow" style={{ margin: 0 }}>{guide.title}</p>
                        <h2 id="guide-buy-heading" className="stk-h2 font-heading" style={{ textAlign: 'left' }}>{`Get the full ${preview.noun}`}</h2>
                        <GuidePrice copy={copy} size="md" />
                        <ul className="gd-checks">
                            {gets.map((line) => (
                                <li key={line}><Check size={15} aria-hidden="true" /> {line}</li>
                            ))}
                        </ul>
                        <div className="gd-product-action">
                            <GuideAction product={guide} copy={copy} addOn={addOn} />
                        </div>
                        {finePrint && <p className="gd-fine">{finePrint}</p>}
                    </div>
                </div>
            </div>
        </StickerStage>
    );
}

function OtherGuides({ guide, phase }: { readonly guide: Guide; readonly phase: GuidePhase }) {
    return (
        <StickerStage variant="cream" aria-labelledby="guide-others-heading" maxWidth={1000}>
            <div className="gd-section-head">
                <p className="stk-eyebrow">More guides</p>
                <h2 id="guide-others-heading" className="stk-h2 font-heading">{`More ${brand.niche.short} career guides`}</h2>
            </div>
            <div className="gd-others">
                {OWN_GUIDE_SLUGS.filter((slug) => slug !== guide.slug).map((slug) => {
                    const other = GUIDES[slug];
                    return (
                        <Link key={slug} href={`/guides/${slug}`} className="stk-card gd-other-card">
                            <div className="gd-cover-wrap"><GuideCover slug={slug} width={64} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <h3 className="stk-title font-heading">{other.title}</h3>
                                <p className="stk-desc">{other.subtitle}</p>
                                <GuidePrice copy={guidePriceCopy(other, phase)} size="sm" withNote={false} />
                            </div>
                        </Link>
                    );
                })}
            </div>
        </StickerStage>
    );
}

function KeyFigures({ preview }: { readonly preview: GuidePreview }) {
    return (
        <StickerStage variant="mint" aria-labelledby="guide-figures-heading" maxWidth={1000}>
            <div className="gd-section-head">
                <p className="stk-eyebrow">Key figures</p>
                <h2 id="guide-figures-heading" className="stk-h2 font-heading">{`Key figures from the ${preview.noun}`}</h2>
            </div>
            <GuideKeyFigures figures={preview.keyFigures} />
        </StickerStage>
    );
}

function Audience({ guide, preview }: { readonly guide: Guide; readonly preview: GuidePreview }) {
    return (
        <StickerStage variant="cream" aria-labelledby="guide-audience-heading" maxWidth={780}>
            <div className="gd-audience">
                <h2 id="guide-audience-heading" className="font-heading">
                    <Users size={20} aria-hidden="true" style={{ color: '#BE185D', flexShrink: 0 }} />
                    {`Who the ${preview.noun} is for`}
                </h2>
                <p>{guide.audience}</p>
                <h3>In short</h3>
                <p>{previewSummary(guide, preview)}</p>
            </div>
        </StickerStage>
    );
}

function Faq({ preview }: { readonly preview: GuidePreview }) {
    return (
        <StickerStage variant="blush" aria-labelledby="guide-faq-heading" maxWidth={780}>
            <div className="gd-section-head">
                <p className="stk-eyebrow">Questions</p>
                <h2 id="guide-faq-heading" className="stk-h2 font-heading">{preview.faqHeading}</h2>
            </div>
            <GuideFaq items={preview.faq} />
        </StickerStage>
    );
}

function Support() {
    return (
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
    );
}

export default function GuidePreviewPage(props: GuidePreviewPageProps) {
    const { guide, preview, phase } = props;
    const chapters = previewChapterCount(preview);
    return (
        <>
            <StickerStyles />
            <style>{`${GUIDES_CSS}${GUIDE_PREVIEW_CSS}`}</style>
            <GuideSchema data={previewProductJsonLd(guide, preview, phase)} />
            <GuideSchema data={previewFaqJsonLd(guide, preview)} />

            <div className="pseo-crumb-band">
                <Breadcrumbs items={[
                    { label: 'Home', href: '/' },
                    { label: 'Career Guides', href: '/guides' },
                    { label: guide.title },
                ]} />
            </div>

            <Hero {...props} chapters={chapters} />
            <Excerpt preview={preview} />
            <Contents guide={guide} preview={preview} chapters={chapters} />
            <KeyFigures preview={preview} />
            <Audience guide={guide} preview={preview} />
            <Faq preview={preview} />
            <BuyAgain {...props} chapters={chapters} />
            <BundleUpsell guide={guide} phase={phase} />
            <OtherGuides guide={guide} phase={phase} />
            <Support />
        </>
    );
}

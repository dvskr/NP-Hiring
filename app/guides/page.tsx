import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, CreditCard, Download, FileText, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react';
import { brand } from '@/config/brand';
import Breadcrumbs from '@/components/Breadcrumbs';
import { StickerAccordion, StickerFooter, StickerHead, StickerStage, StickerStyles } from '@/components/sticker';
import GuideAction from '@/components/guides/GuideAction';
import GuideCover, { COVER_PALETTES, CoverStack } from '@/components/guides/GuideCover';
import GuidePrice from '@/components/guides/GuidePrice';
import { GUIDES_CSS } from '@/components/guides/styles';
import { stickerFill } from '@/lib/design/sticker-css';
import {
    BUNDLES,
    BUNDLE_ORDER,
    GUIDES,
    GUIDE_SLUGS,
    allProducts,
    totalPages,
    type Bundle,
    type ProductSlug,
} from '@/lib/guides/catalog';
import { guidePriceCopy, type GuidePriceCopy } from '@/lib/guides/phase';
import { GUIDES_STORE_OG_CARD, guideOgImageUrl } from '@/lib/guides/og';
import { guidesFaqs, guidesMetaSentence, guidesStorePills, type GuidesPill } from './guides-copy';

/**
 * /guides: the guides store. The Complete Library leads, then the other
 * bundles, the single guides, a comparison table and the FAQ.
 *
 * Every price block is guidePriceCopy(product, now) and every action follows
 * its phase: the claim form while the guides are free (through
 * config.promoEndsAt), checkout after it. The page reads the clock per
 * render and re-renders hourly, like /pricing, so the switch shows within the
 * hour without a deploy; it is in PROMO_SWITCH_PATHS for its sitemap date.
 */
export const revalidate = 3600;

const LIBRARY = BUNDLES['complete-library'];
const PAGE_URL = `${brand.baseUrl}/guides`;

export async function generateMetadata(): Promise<Metadata> {
    const ogImage = guideOgImageUrl(GUIDES_STORE_OG_CARD);
    const title = `${brand.niche.short} Career Guides: Pay Data, Interviews and Negotiation`;
    const summary = `Six PDF guides for ${brand.niche.descriptor}s: pay data, the first year, interviews, negotiation, telehealth and starting a practice.`;
    return {
        title,
        description: `${summary} ${guidesMetaSentence(new Date())}`,
        openGraph: {
            title: `${brand.niche.short} Career Guides`,
            description: summary,
            url: PAGE_URL,
            images: [{ url: ogImage, width: 1200, height: 630, alt: `${brand.niche.short} career guides` }],
        },
        twitter: { card: 'summary_large_image', images: [ogImage] },
        alternates: { canonical: PAGE_URL },
    };
}

const PILL_ICONS: Readonly<Record<GuidesPill['key'], LucideIcon>> = {
    pdf: FileText,
    download: Download,
    account: UserCheck,
    purchase: CreditCard,
    stripe: ShieldCheck,
};

function Pills({ pills }: { readonly pills: readonly GuidesPill[] }) {
    return (
        <ul className="gd-pill-row gd-pill-row-center" style={{ listStyle: 'none', padding: 0, margin: '0 0 44px' }}>
            {pills.map((pill) => {
                const Icon = PILL_ICONS[pill.key];
                return (
                    <li key={pill.key} className="gd-pill">
                        <Icon size={13} aria-hidden="true" /> {pill.label}
                    </li>
                );
            })}
        </ul>
    );
}

type PriceCopies = Readonly<Record<ProductSlug, GuidePriceCopy>>;

function LibraryHero({ copy }: { readonly copy: GuidePriceCopy }) {
    return (
        <article className="gd-hero" aria-labelledby="library-heading">
            <div className="gd-hero-art">
                <div className="gd-stack-lg">
                    <CoverStack guides={LIBRARY.guides} width={120} />
                </div>
            </div>
            <div className="gd-hero-copy">
                {LIBRARY.bestValue && <span className="stk-chip" style={{ background: stickerFill(1) }}>Best value</span>}
                <h2 id="library-heading" className="gd-hero-title font-heading">{LIBRARY.title}</h2>
                <p className="gd-hero-lede">
                    {LIBRARY.subtitle}, {totalPages(LIBRARY)} pages in all, for every {brand.niche.short} from final semester to practice owner.
                </p>
                <GuidePrice copy={copy} size="lg" />
                <GuideAction product={LIBRARY} copy={copy} />
                <Link href={`/guides/${LIBRARY.slug}`} className="stk-link" style={{ alignSelf: 'flex-start' }}>
                    See every chapter in the library <ArrowRight size={14} aria-hidden="true" />
                </Link>
            </div>
        </article>
    );
}

function BundleCard({ bundle, copy, index }: { readonly bundle: Bundle; readonly copy: GuidePriceCopy; readonly index: number }) {
    return (
        <article className="stk-card stk-static" aria-labelledby={`bundle-${bundle.slug}`} style={{ gap: '16px' }}>
            <span className="stk-chip" style={{ background: stickerFill(index) }}>{bundle.guides.length} guides</span>
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
                <CoverStack guides={bundle.guides} width={92} />
            </div>
            <div>
                <h3 id={`bundle-${bundle.slug}`} className="stk-title font-heading" style={{ fontSize: '22px' }}>{bundle.title}</h3>
                <p className="stk-desc" style={{ fontSize: '13.5px', margin: 0 }}>{bundle.summary}</p>
            </div>
            <ul className="gd-checks">
                {bundle.guides.map((slug) => (
                    <li key={slug}>
                        <Check size={15} aria-hidden="true" />
                        {GUIDES[slug].title}
                    </li>
                ))}
            </ul>
            <div style={{ marginTop: 'auto', display: 'grid', gap: '14px' }}>
                <GuidePrice copy={copy} size="md" />
                <GuideAction product={bundle} copy={copy} variant="secondary" />
                <Link href={`/guides/${bundle.slug}`} className="stk-link" style={{ justifySelf: 'center' }}>
                    See what is inside <ArrowRight size={14} aria-hidden="true" />
                </Link>
            </div>
        </article>
    );
}

function SingleGuides({ copies }: { readonly copies: PriceCopies }) {
    return (
        <div className="stk-grid stk-cols-3">
            {GUIDE_SLUGS.map((slug, index) => {
                const guide = GUIDES[slug];
                return (
                    <Link key={slug} href={`/guides/${slug}`} className="stk-card">
                        <div className="gd-row-card">
                            <div className="gd-cover-wrap"><GuideCover slug={slug} width={88} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                                <span className="stk-chip" style={{ background: stickerFill(index) }}>{COVER_PALETTES[slug].label}</span>
                                <h3 className="stk-title font-heading" style={{ fontSize: '17px', margin: 0 }}>{guide.title}</h3>
                                <p className="stk-desc" style={{ margin: 0 }}>{guide.subtitle}</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', margin: '16px 0 14px' }}>
                            <GuidePrice copy={copies[slug]} size="sm" withNote={false} />
                            <span className="gd-meta">{guide.pages} pages</span>
                        </div>
                        <StickerFooter index={index} action="See chapters" />
                    </Link>
                );
            })}
        </div>
    );
}

function PriceCell({ copy }: { readonly copy: GuidePriceCopy }) {
    return (
        <>
            {copy.price}
            {copy.listPrice && (
                <>
                    {' '}
                    <span className="gd-price-was" aria-hidden="true">{copy.listPrice}</span>
                </>
            )}
        </>
    );
}

function ComparisonTable({ copies }: { readonly copies: PriceCopies }) {
    return (
        <div className="stk-table-wrap">
            <table className="stk-table" style={{ minWidth: '600px' }}>
                <caption>Which guides each bundle includes</caption>
                <thead>
                    <tr>
                        <th scope="col">Guide</th>
                        <th scope="col" className="gd-cell-center">On its own</th>
                        {BUNDLE_ORDER.map((slug) => (
                            <th key={slug} scope="col" className="gd-cell-center">{BUNDLES[slug].title}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {GUIDE_SLUGS.map((slug) => (
                        <tr key={slug}>
                            <th scope="row">
                                <Link href={`/guides/${slug}`}>{GUIDES[slug].title}</Link>
                            </th>
                            <td className="gd-cell-center"><PriceCell copy={copies[slug]} /></td>
                            {BUNDLE_ORDER.map((bundle) => (
                                <td key={bundle} className="gd-cell-center">
                                    {BUNDLES[bundle].guides.includes(slug) ? (
                                        <>
                                            <Check size={18} className="gd-table-mark" aria-hidden="true" />
                                            <span className="sr-only">Included</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="gd-table-none" aria-hidden="true">·</span>
                                            <span className="sr-only">Not included</span>
                                        </>
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                    <tr>
                        <th scope="row">Bundle price</th>
                        <td className="gd-cell-center" />
                        {BUNDLE_ORDER.map((slug) => (
                            <td key={slug} className="gd-cell-center" style={{ fontWeight: 800, color: '#7A1C2B' }}>
                                <PriceCell copy={copies[slug]} />
                            </td>
                        ))}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

export default function GuidesStorePage() {
    // One clock read per render: every price block, action, pill and answer switches together.
    const now = new Date();
    const copies = Object.fromEntries(allProducts().map((product) => [product.slug, guidePriceCopy(product, now)])) as PriceCopies;
    const pills = guidesStorePills(now);
    const faqs = guidesFaqs(now);

    return (
        <>
            <StickerStyles />
            <style>{GUIDES_CSS}</style>

            <div className="pseo-crumb-band">
                <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Career Guides' }]} />
            </div>

            <StickerStage variant="grid" aria-labelledby="guides-heading">
                <StickerHead
                    eyebrow={`${brand.niche.short} Career Guides`}
                    title={`Practical guides for every stage of an ${brand.niche.short} career`}
                    id="guides-heading"
                    headingLevel={1}
                    lede={`Six PDF guides for ${brand.niche.descriptor}s in every specialty: pay data, your first year, interviews, negotiation, telehealth rules and a practice launch toolkit.`}
                />
                <Pills pills={pills} />
                <LibraryHero copy={copies[LIBRARY.slug]} />
            </StickerStage>

            <StickerStage variant="peach" aria-labelledby="bundles-heading">
                <StickerHead eyebrow="Bundles" title="Pick the set for where you are" id="bundles-heading" />
                <div className="stk-grid stk-cols-2">
                    {BUNDLE_ORDER.filter((slug) => slug !== LIBRARY.slug).map((slug, index) => (
                        <BundleCard key={slug} bundle={BUNDLES[slug]} copy={copies[slug]} index={index} />
                    ))}
                </div>
            </StickerStage>

            <StickerStage variant="mint" aria-labelledby="singles-heading">
                <StickerHead eyebrow="Single guides" title="Or pick one guide" id="singles-heading" />
                <SingleGuides copies={copies} />
            </StickerStage>

            <StickerStage variant="cream" aria-labelledby="compare-heading">
                <StickerHead eyebrow="Compare" title="What each bundle includes" id="compare-heading" />
                <ComparisonTable copies={copies} />
            </StickerStage>

            <StickerStage variant="blush" aria-labelledby="faq-heading" maxWidth={820}>
                <StickerHead eyebrow="Questions" title="Common questions" id="faq-heading" />
                <StickerAccordion items={faqs.map(({ question, answer }) => ({ question, answer }))} />
            </StickerStage>
        </>
    );
}

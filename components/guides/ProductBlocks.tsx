import Link from 'next/link';
import { StickerHead, StickerStage } from '@/components/sticker';
import { CoverStack } from '@/components/guides/GuideCover';
import GuidePrice from '@/components/guides/GuidePrice';
import { stickerFill } from '@/lib/design/sticker-css';
import { bundlesContaining, type Guide } from '@/lib/guides/catalog';
import { guidePriceCopy, type GuidePhase, type GuidePriceCopy } from '@/lib/guides/phase';

/**
 * Pieces of the guide product page shared by the plain page
 * (app/guides/[slug]/page.tsx) and the preview page
 * (components/guides/GuidePreviewPage.tsx). Every price block comes from
 * guidePriceCopy for the phase the page read once per render.
 */

/** What a reader gets with any product, in both phases. */
export const WITH_EVERY_GUIDE: readonly string[] = ['Read on any device or print', 'The latest edition on every download', 'No account needed'];

/** The checkmark lines for a product in the phase of its price copy: paying once is a promise only checkout can make. */
export function productPromises(copy: GuidePriceCopy): readonly string[] {
    return copy.phase === 'paid' ? ['Pay once, keep it', ...WITH_EVERY_GUIDE] : WITH_EVERY_GUIDE;
}

/** The bundles that hold a guide, cheapest first, priced for the phase. */
export function BundleUpsell({ guide, phase }: { readonly guide: Guide; readonly phase: GuidePhase }) {
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

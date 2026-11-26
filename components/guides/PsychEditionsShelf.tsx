import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { psychEditions } from '@/config/psych-editions';
import { StickerHead, StickerStage } from '@/components/sticker';
import GuideAction from '@/components/guides/GuideAction';
import GuideCover, { COVER_PALETTES, CoverStack } from '@/components/guides/GuideCover';
import GuidePrice from '@/components/guides/GuidePrice';
import { stickerFill } from '@/lib/design/sticker-css';
import { BUNDLES, GUIDES, PSYCH_GUIDE_SLUGS, totalPages, type ProductSlug } from '@/lib/guides/catalog';
import type { GuidePriceCopy } from '@/lib/guides/phase';

/**
 * The psych editions' shelf on /guides (owner decision 2026-11-26): the
 * sister board's six guides and their library, sold here, in a lavender band
 * right after the hero and before this board's own bundles, with a pointer to
 * it in the hero itself so it shows above the fold. The copy is in
 * config/psych-editions.ts; every price block and action is the page's
 * guidePriceCopy for the phase, so the shelf claims or sells exactly as the
 * rest of the store does.
 */

/** The shelf's anchor, the target of the hero's pointer. */
export const PSYCH_EDITIONS_ID = 'psych-editions';
const HEADING_ID = 'psych-editions-heading';
const LIBRARY_HEADING_ID = 'psych-library-heading';
const LIBRARY = BUNDLES['psych-library'];

type PriceCopies = Readonly<Record<ProductSlug, GuidePriceCopy>>;

/** The hero's pointer to the shelf, under the pills: in view on a desktop's first screen. */
export function PsychEditionsJump() {
    return (
        <p className="gd-jump">
            <a href={`#${PSYCH_EDITIONS_ID}`} className="gd-jump-link">
                {psychEditions.store.jump} <ArrowDown size={15} aria-hidden="true" />
            </a>
        </p>
    );
}

function LibraryCard({ copy }: { readonly copy: GuidePriceCopy }) {
    return (
        <article className="stk-card stk-static gd-psych-library" aria-labelledby={LIBRARY_HEADING_ID}>
            {LIBRARY.bestValue && <span className="stk-chip" style={{ background: stickerFill(1) }}>Best value</span>}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <CoverStack guides={LIBRARY.guides} width={72} />
            </div>
            <div>
                <h3 id={LIBRARY_HEADING_ID} className="stk-title font-heading" style={{ fontSize: '22px' }}>{LIBRARY.title}</h3>
                <p className="stk-desc" style={{ margin: 0 }}>{LIBRARY.subtitle}, {totalPages(LIBRARY)} pages in all.</p>
            </div>
            <GuidePrice copy={copy} size="md" />
            <GuideAction product={LIBRARY} copy={copy} />
            <Link href={`/guides/${LIBRARY.slug}`} className="stk-link" style={{ alignSelf: 'flex-start' }}>
                {psychEditions.store.libraryLink} <ArrowRight size={14} aria-hidden="true" />
            </Link>
        </article>
    );
}

function EditionCards({ copies }: { readonly copies: PriceCopies }) {
    return (
        <div className="gd-psych-grid">
            {PSYCH_GUIDE_SLUGS.map((slug, index) => {
                const guide = GUIDES[slug];
                return (
                    <Link key={slug} href={`/guides/${slug}`} className="stk-card gd-psych-item">
                        <div className="gd-row-card">
                            <div className="gd-cover-wrap"><GuideCover slug={slug} width={64} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                                <span className="stk-chip" style={{ background: stickerFill(index) }}>{COVER_PALETTES[slug].label}</span>
                                <h3 className="stk-title font-heading" style={{ fontSize: '15.5px', margin: 0 }}>{guide.title}</h3>
                            </div>
                        </div>
                        <div className="gd-psych-item-foot">
                            <GuidePrice copy={copies[slug]} size="sm" withNote={false} />
                            <span className="gd-meta">{guide.pages} pages</span>
                        </div>
                    </Link>
                );
            })}
        </div>
    );
}

/** The shelf: its heading, the library with its action, and a card per edition linking its product page. */
export default function PsychEditionsShelf({ copies }: { readonly copies: PriceCopies }) {
    const { store, attribution } = psychEditions;
    return (
        <StickerStage variant="cream" className="gd-stage-psych" id={PSYCH_EDITIONS_ID} aria-labelledby={HEADING_ID}>
            <StickerHead
                eyebrow={store.eyebrow}
                title={store.heading}
                id={HEADING_ID}
                lede={(
                    <>
                        {store.lede}{' '}
                        <span className="gd-attribution" data-sister-board="">{attribution}</span>
                    </>
                )}
            />
            <div className="gd-psych">
                <LibraryCard copy={copies[LIBRARY.slug]} />
                <EditionCards copies={copies} />
            </div>
        </StickerStage>
    );
}

import type { GuidePriceCopy } from '@/lib/guides/phase';

interface GuidePriceProps {
    /** guidePriceCopy(product, now), decided by the page at render time. */
    readonly copy: GuidePriceCopy;
    readonly size?: 'lg' | 'md' | 'sm';
    /** Print the line under the price (the date the free period ends); cards in a row leave it to the product page. */
    readonly withNote?: boolean;
}

/**
 * The price block every store card and page prints, and the only one: the
 * price, the catalog price struck beside it while the guides are free, and
 * the note under it. It prints guidePriceCopy's fields and no copy of its
 * own, so the block switches with the phase and with nothing else.
 */
export default function GuidePrice({ copy, size = 'md', withNote = true }: GuidePriceProps) {
    return (
        <div>
            <p className={`gd-price gd-price-${size}`}>
                <span className="gd-price-now font-heading">{copy.price}</span>
                {copy.listPrice && (
                    // The note says the same in words, so assistive technology reads that instead.
                    <span className="gd-price-was" aria-hidden={withNote && copy.note ? true : undefined}>{copy.listPrice}</span>
                )}
            </p>
            {withNote && copy.note && <p className="gd-price-note">{copy.note}</p>}
        </div>
    );
}

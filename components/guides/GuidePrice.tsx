import type { GuidePriceCopy } from '@/lib/guides/phase';

interface GuidePriceProps {
    /** guidePriceCopy(product, phase), decided by the page. */
    readonly copy: GuidePriceCopy;
    readonly size?: 'lg' | 'md' | 'sm';
    /** Print the line under the price (the price after the free period, or what a bundle saves); cards in a row leave it to the product page. */
    readonly withNote?: boolean;
}

/**
 * The price block every store card and page prints, and the only one: the
 * price, the price struck beside it (the catalog price while the guides are
 * free, a bundle's guides bought one at a time once they are sold), and the
 * note under it. It prints guidePriceCopy's fields and no copy of its own, so
 * the block switches with the phase and with nothing else.
 */
export default function GuidePrice({ copy, size = 'md', withNote = true }: GuidePriceProps) {
    const noteShown = Boolean(withNote && copy.note);
    return (
        <div>
            <p className={`gd-price gd-price-${size}`}>
                <span className="gd-price-now font-heading">{copy.price}</span>
                {copy.listPrice && (
                    // The note says the same in words, so assistive technology reads that instead.
                    <span className="gd-price-was" aria-hidden={noteShown ? true : undefined}>
                        {!noteShown && copy.listPriceLabel && <span className="sr-only">{copy.listPriceLabel}: </span>}
                        {copy.listPrice}
                    </span>
                )}
            </p>
            {noteShown && <p className="gd-price-note">{copy.note}</p>}
        </div>
    );
}

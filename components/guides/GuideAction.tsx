import { GUIDES, addOnEligible, addOnFor, formatPrice, type Product } from '@/lib/guides/catalog';
import { guidePriceCopy, type GuidePriceCopy } from '@/lib/guides/phase';
import BuyButton, { type AddOnOffer } from './BuyButton';
import ClaimForm from './ClaimForm';

/**
 * The add-on offer for a product that does not include its edition's add-on
 * guide, or null. Checkout is the only place it is offered, so its button
 * label is the paid guidePriceCopy for the combined amount: even the add-on
 * total comes from the one price source.
 */
export function addOnOffer(product: Product): AddOnOffer | null {
    if (!addOnEligible(product)) return null;
    const addOn = addOnFor(product);
    return {
        title: GUIDES[addOn.guide].title,
        price: formatPrice(addOn.priceCents),
        ctaWithAddOn: guidePriceCopy({ ...product, priceCents: product.priceCents + addOn.priceCents }, 'paid').cta,
    };
}

interface GuideActionProps {
    readonly product: Product;
    /** guidePriceCopy(product, phase), decided by the page. */
    readonly copy: GuidePriceCopy;
    /** The paid phase's add-on checkbox; the claim takes no add-on. */
    readonly addOn?: AddOnOffer | null;
    readonly variant?: 'primary' | 'secondary';
}

/**
 * The product's action for the phase its copy was decided in: the claim form
 * while the guides are free, checkout once it is set up. A Buy button is
 * rendered only in the paid phase, the only one in which checkout can work.
 */
export default function GuideAction({ product, copy, addOn = null, variant = 'primary' }: GuideActionProps) {
    if (copy.phase === 'free') return <ClaimForm product={product.slug} cta={copy.cta} />;
    return <BuyButton product={product.slug} label={copy.cta} addOn={addOn} variant={variant} />;
}

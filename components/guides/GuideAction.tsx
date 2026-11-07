import { ADD_ON, GUIDES, addOnEligible, formatPrice, type Product } from '@/lib/guides/catalog';
import { guidePriceCopy, type GuidePriceCopy } from '@/lib/guides/phase';
import BuyButton, { type AddOnOffer } from './BuyButton';
import ClaimForm from './ClaimForm';

/**
 * The add-on offer for a product that does not include the add-on guide, or
 * null. Its button label is guidePriceCopy for the combined amount, so even
 * the add-on total comes from the one price source.
 */
export function addOnOffer(product: Product, now: Date): AddOnOffer | null {
    if (!addOnEligible(product)) return null;
    return {
        title: GUIDES[ADD_ON.guide].title,
        price: formatPrice(ADD_ON.priceCents),
        ctaWithAddOn: guidePriceCopy({ ...product, priceCents: product.priceCents + ADD_ON.priceCents }, now).cta,
    };
}

interface GuideActionProps {
    readonly product: Product;
    /** guidePriceCopy(product, now), decided by the page at render time. */
    readonly copy: GuidePriceCopy;
    /** The paid phase's add-on checkbox; the claim takes no add-on. */
    readonly addOn?: AddOnOffer | null;
    readonly variant?: 'primary' | 'secondary';
}

/** The product's action for the phase its copy was decided in: the claim form while free, checkout after. */
export default function GuideAction({ product, copy, addOn = null, variant = 'primary' }: GuideActionProps) {
    if (copy.phase === 'promo') return <ClaimForm product={product.slug} cta={copy.cta} />;
    return <BuyButton product={product.slug} label={copy.cta} addOn={addOn} variant={variant} />;
}

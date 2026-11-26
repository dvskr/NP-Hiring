import { brand } from '@/config/brand';
import { allProducts, type Product } from './catalog';
import { guideOgImageUrl, productOgCard } from './og';
import type { GuidePhase } from './phase';

/**
 * Structured data for the guides store. The offer is the one the page makes
 * in the same phase: free to claim (price 0) until checkout is set up, then
 * the catalog price the checkout charges. No rating or review markup: there
 * are no reviews to describe.
 */

const ORGANIZATION_ID = `${brand.baseUrl}/#organization`;

function productUrl(product: Product): string {
    return `${brand.baseUrl}/guides/${product.slug}`;
}

/** schema.org Product with a single USD Offer for one guide or bundle, priced for `phase`. */
export function productJsonLd(product: Product, phase: GuidePhase): Record<string, unknown> {
    const url = productUrl(product);
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${url}#product`,
        name: product.title,
        description: product.summary,
        image: [guideOgImageUrl(productOgCard(product))],
        sku: product.slug,
        url,
        brand: { '@id': ORGANIZATION_ID },
        offers: {
            '@type': 'Offer',
            url,
            price: phase === 'free' ? '0.00' : (product.priceCents / 100).toFixed(2),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            seller: { '@id': ORGANIZATION_ID },
        },
    };
}

/** schema.org ItemList of every product the store offers, in catalog order. */
export function storeItemListJsonLd(): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${brand.niche.short} Career Guides`,
        itemListElement: allProducts().map((product, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: productUrl(product),
            name: product.title,
        })),
    };
}

/**
 * The JSON-LD text for a script element. Angle brackets are escaped so no
 * value can end the element early, as on every other JSON-LD block here.
 */
export function guideJsonLdString(data: Record<string, unknown>): string {
    return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

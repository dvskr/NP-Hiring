/**
 * Where a guides store product page points search engines.
 *
 * This board's own products are self canonical. A psych edition is the
 * sister board's guide, sold here as well (owner decision 2026-11-26): its
 * page names the sister board's page for the same guide as its canonical, so
 * the two copies never compete in search and the signals go to the store
 * that wrote it. Its page stays crawlable, so its links are still followed,
 * and it is left out of this site's sitemap and the store's ItemList, which
 * list canonical pages only.
 *
 * Next.js prints alternates.canonical as given when it is an absolute URL
 * (app/layout.tsx's metadataBase only resolves relative ones), and nothing
 * else on this site sets a canonical for these pages: middleware.ts sends no
 * Link header.
 */
import { brand } from '@/config/brand';
import { sisterBoardGuidePageUrl } from '@/lib/sister-board';
import type { Product } from './catalog';

/** This site's page for a product, where it is claimed or bought. */
export function productPageUrl(product: Product): string {
    return `${brand.baseUrl}/guides/${product.slug}`;
}

/** The page's canonical: its own address, or for a psych edition the sister board's page for the same product. */
export function productCanonicalUrl(product: Product): string {
    return product.sisterSlug ? sisterBoardGuidePageUrl(product.sisterSlug) : productPageUrl(product);
}

/** Whether this site's page is the product's canonical: only those go in the sitemap and the store's ItemList. */
export function isSelfCanonical(product: Product): boolean {
    return !product.sisterSlug;
}

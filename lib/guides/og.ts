import { brand } from '@/config/brand';
import { psychEditions } from '@/config/psych-editions';
import type { Product } from './catalog';

/** The title and subtitle a guides store share card prints. */
export interface GuideOgCard {
    readonly title: string;
    readonly subtitle: string;
}

/** The store's own card. */
export const GUIDES_STORE_OG_CARD: GuideOgCard = {
    title: `${brand.niche.short} Career Guides`,
    subtitle: 'Pay, interviews, negotiation, telehealth and practice',
};

/**
 * Share card for a store product. Card copy stays short and carries no
 * figures (tests/lib/guides-catalog.test.ts): the year in a title is
 * dropped, and a price never appears on a card, because a card is cached
 * by the networks that fetch it and a price on it would outlive a price change.
 * A psych edition's second line names its readers from config/psych-editions.ts.
 */
export function productOgCard(product: Product): GuideOgCard {
    return { title: product.title.replace(/^\d{4}\s+/, ''), subtitle: cardSubtitle(product) };
}

function cardSubtitle(product: Product): string {
    const guide = product.kind === 'guide';
    if (product.edition === 'psych') return guide ? psychEditions.labels.ogGuide : psychEditions.labels.ogBundle;
    return guide ? `Career guide for ${brand.niche.descriptor}s` : `Guide bundle for ${brand.niche.descriptor}s`;
}

/** The /api/og page card URL for a guides store card (the same renderer every page uses). */
export function guideOgImageUrl(card: GuideOgCard): string {
    return `${brand.baseUrl}/api/og?title=${encodeURIComponent(card.title)}&type=page&subtitle=${encodeURIComponent(card.subtitle)}`;
}

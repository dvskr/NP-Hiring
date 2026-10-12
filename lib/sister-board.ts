/**
 * Sister board routing helpers. The board's name, domain, campaigns and copy
 * live in config/sister-board.ts; this module only reads them, so no literal
 * for the other board ever lands in lib/ (the niche-copy and brand-leak
 * scanners count every occurrence, comments included).
 */
import {
    sisterBoard,
    type SisterBoardCampaign,
    type SisterBoardPath,
} from '@/config/sister-board';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';

/** Absolute link to a sister board page, tagged so the visit is attributed to its placement. */
export function sisterBoardUrl(path: SisterBoardPath, campaign: SisterBoardCampaign): string {
    const url = new URL(sisterBoard.paths[path], sisterBoard.baseUrl);
    url.searchParams.set('utm_source', sisterBoard.utm.source);
    url.searchParams.set('utm_medium', sisterBoard.utm.medium);
    url.searchParams.set('utm_campaign', sisterBoard.campaigns[campaign]);
    return url.toString();
}

/** True only for the specialty the sister board serves (the taxonomy slug, never a guess). */
export function isSisterBoardSpecialty(slug: string | null | undefined): boolean {
    return Boolean(slug) && PSYCH_SPECIALTY_SLUG !== undefined && slug === PSYCH_SPECIALTY_SLUG;
}

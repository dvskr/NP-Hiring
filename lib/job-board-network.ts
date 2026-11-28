/**
 * The job boards run by the same company, linked from each other's footers
 * ("More Job Boards", components/Footer.tsx).
 *
 * A board is linked only once it is open to the public: a link to a board
 * still behind the host's sign-in wall would send visitors and crawlers to
 * a login page. The five Jobs Hub boards opened on 2026-11-28.
 *
 * Anchors are the boards' names, never keyword phrases: these are links
 * between sites with one owner, and a name is what a reader looks for.
 *
 * The footer marks every one of them rel="nofollow". Seven sites with one
 * owner linking each other from every page is what Google's link spam policy
 * calls widely distributed footer links: they would earn a sister board
 * nothing in search and could cost the whole network trust. They are there
 * for readers; ranking links have to come from other sites.
 *
 * The sister board's name and address come from config/sister-board.ts and
 * this board's own from config/brand.ts: config/ is the one folder the
 * brand-leak and niche-copy scanners skip, so neither is spelled here.
 */
import { brand } from '@/config/brand';
import { sisterBoard } from '@/config/sister-board';

export interface NetworkBoard {
    /** The board's public name, used as the link text. */
    readonly name: string;
    /** The board's canonical home page. */
    readonly url: string;
    /** True once the board is open to the public. */
    readonly live: boolean;
}

export const JOB_BOARD_NETWORK: readonly NetworkBoard[] = [
    { name: sisterBoard.name, url: sisterBoard.baseUrl, live: true },
    { name: brand.name, url: brand.baseUrl, live: true },
    { name: 'ABA Jobs Hub', url: 'https://abajobshub.com', live: true },
    { name: 'PA Jobs Hub', url: 'https://pajobshub.com', live: true },
    { name: 'Therapist Jobs Hub', url: 'https://therapistjobshub.com', live: true },
    { name: 'CRNA Jobs Hub', url: 'https://crnajobshub.com', live: true },
    { name: 'SLP Jobs Hub', url: 'https://slpjobshub.com', live: true },
];

/** This site's own host, which its footer never links. */
export const SELF_HOST: string = brand.domain;

/** The boards a footer links: every live board except the site itself. */
export function sisterBoards(selfHost: string = SELF_HOST): readonly NetworkBoard[] {
    return JOB_BOARD_NETWORK.filter((board) => board.live && new URL(board.url).host !== selfHost);
}

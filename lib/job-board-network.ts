/**
 * The job boards run by the same company, linked from each other's footers
 * ("More Job Boards", components/Footer.tsx).
 *
 * A board is linked only once it is open to the public. The five Jobs Hub
 * boards still sit behind the host's sign-in wall, so a link to one of them
 * would send visitors and crawlers to a login page; each turns on with its
 * own `live` flag when it launches.
 *
 * Anchors are the boards' names, never keyword phrases: these are links
 * between sites with one owner, and a name is what a reader looks for.
 */
import { brand } from '@/config/brand';

export interface NetworkBoard {
    /** The board's public name, used as the link text. */
    readonly name: string;
    /** The board's canonical home page. */
    readonly url: string;
    /** True once the board is open to the public. */
    readonly live: boolean;
}

export const JOB_BOARD_NETWORK: readonly NetworkBoard[] = [
    { name: 'PMHNP Hiring', url: 'https://pmhnphiring.com', live: true },
    { name: 'NP Hiring', url: 'https://nphiring.com', live: true },
    { name: 'ABA Jobs Hub', url: 'https://abajobshub.com', live: false },
    { name: 'PA Jobs Hub', url: 'https://pajobshub.com', live: false },
    { name: 'Therapist Jobs Hub', url: 'https://therapistjobshub.com', live: false },
    { name: 'CRNA Jobs Hub', url: 'https://crnajobshub.com', live: false },
    { name: 'SLP Jobs Hub', url: 'https://slpjobshub.com', live: false },
];

/** This site's own host, which its footer never links. */
export const SELF_HOST: string = brand.domain;

/** The boards a footer links: every live board except the site itself. */
export function sisterBoards(selfHost: string = SELF_HOST): readonly NetworkBoard[] {
    return JOB_BOARD_NETWORK.filter((board) => board.live && new URL(board.url).host !== selfHost);
}

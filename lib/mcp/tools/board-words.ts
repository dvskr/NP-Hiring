import { brand } from '@/config/brand';

/**
 * The words the assistant tools use for NP Hiring, all from config/brand.ts,
 * so a tool says what the site's own pages say.
 */

/** The site as it signs its own text. */
export const BOARD_NAME: string = brand.name;

/** The role's token for a title or a label ("Search NP jobs"). */
export const ROLE_TOKEN: string = brand.niche.short;

/** The site's own host, as a person would paste a job's address from it. */
export const BOARD_DOMAIN: string = brand.domain;

/** "NP jobs" inside a sentence. */
export function roleJobsProse(): string {
  return `${brand.niche.short} jobs`;
}

/** Members of the profession, in a sentence: "nurse practitioners". */
export function rolePlural(): string {
  return `${brand.niche.descriptor}s`;
}

/**
 * Who the site serves, for a description that introduces it: every nurse
 * practitioner specialty and the other advanced practice registered nurse
 * roles (CRNA, CNM, CNS).
 */
export const AUDIENCE_PROSE = 'nurse practitioners and other advanced practice registered nurses (APRNs)';

/**
 * lib/pseo/practice-environment.ts
 *
 * One read model for every regulatory sentence a pSEO page prints about a
 * state: AANP practice authority (lib/state-practice-authority.ts), Nurse
 * Licensure Compact status and the board directory (lib/blog-license-guides.ts,
 * verified against the NCSBN roster on NLC_ROSTER_VERIFIED_AT), and the
 * nearby-state list (lib/pseo/neighboring-states.ts).
 *
 * Every function here is pure and dataset-backed except `isLicenseGuideLive`,
 * which asks the blog layer which guide slugs are actually published so no
 * page links a guide that would 404. Copy rules: "nearby states" (never
 * "bordering"); the compact covers the RN license, never the APRN license.
 */
import { cache } from 'react';
import { brand } from '@/config/brand';
import { licenseGuideSlug } from '@/config/niche/content-map';
import {
  getStatePracticeAuthority,
  getAuthorityLabel,
  type PracticeAuthority,
} from '@/lib/state-practice-authority';
import {
  LICENSE_GUIDE_STATES,
  NLC_ROSTER_VERIFIED_AT,
  type LicenseGuideState,
  type NlcStatus,
} from '@/lib/blog-license-guides';
import { indefiniteArticle } from '@/lib/display-text';
import { getNeighboringStates } from './neighboring-states';

export interface PracticeEnvironment {
  stateName: string;
  stateCode: string;
  /** URL slug shared by /jobs/state, /salary-guide and the license guide. */
  stateSlug: string;
  authority: PracticeAuthority;
  /** Long label, e.g. "Reduced Practice (Collaborative Agreement Required)". */
  authorityLabel: string;
  /** Dataset description, e.g. "Full Practice Authority" / "Reduced Practice". */
  authorityDescription: string;
  /** Lowercase adjective phrase for prose, e.g. "reduced practice". */
  authorityShort: string;
  /** State-specific rule text, published verbatim. */
  details: string;
  nlcStatus: NlcStatus;
  boardName: string;
  boardUrl: string;
  /** ISO date the compact roster was last verified, e.g. "2026-08-11". */
  nlcVerifiedAt: string;
  /** Blog slug of the state's license guide, e.g. "np-license-texas". */
  licenseGuideSlug: string;
}

/** Lowercase adjective phrase per AANP tier (spec 4, section 4). */
export const AUTHORITY_SHORT: Readonly<Record<PracticeAuthority, string>> = {
  full: 'full practice',
  reduced: 'reduced practice',
  restricted: 'restricted practice',
};

/** Title Case form for title strings, e.g. "Restricted Practice". */
export const AUTHORITY_TITLE: Readonly<Record<PracticeAuthority, string>> = {
  full: 'Full Practice',
  reduced: 'Reduced Practice',
  restricted: 'Restricted Practice',
};

const LICENSE_STATE_BY_NAME: ReadonlyMap<string, LicenseGuideState> = new Map(
  LICENSE_GUIDE_STATES.map((s) => [s.name, s]),
);

/** Human form of NLC_ROSTER_VERIFIED_AT for prose ("August 11, 2026"). */
export const NLC_VERIFIED_LABEL = new Date(`${NLC_ROSTER_VERIFIED_AT}T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Practice environment for a full state name, or null off the dataset. */
export function getPracticeEnvironment(stateName: string): PracticeEnvironment | null {
  const authority = getStatePracticeAuthority(stateName);
  const license = LICENSE_STATE_BY_NAME.get(stateName);
  if (!authority || !license) return null;
  return {
    stateName,
    stateCode: license.code,
    stateSlug: license.stateSlug,
    authority: authority.authority,
    authorityLabel: getAuthorityLabel(authority.authority),
    authorityDescription: authority.description,
    authorityShort: AUTHORITY_SHORT[authority.authority],
    details: authority.details,
    nlcStatus: license.nlcStatus,
    boardName: license.boardName,
    boardUrl: license.boardUrl,
    nlcVerifiedAt: NLC_ROSTER_VERIFIED_AT,
    licenseGuideSlug: licenseGuideSlug(license.stateSlug),
  };
}

/** Practice environments of the nearby states that have a dataset row. */
export function getNearbyStates(stateName: string): PracticeEnvironment[] {
  return getNeighboringStates(stateName)
    .map((name) => getPracticeEnvironment(name))
    .filter((env): env is PracticeEnvironment => env !== null);
}

/**
 * The three-branch compact sentence (category-state S6, city C6). The
 * compact covers the RN license beneath the APRN credential; the APRN
 * license is always issued by the state itself. Null off the dataset.
 */
export function nlcSentence(stateName: string): string | null {
  const status = LICENSE_STATE_BY_NAME.get(stateName)?.nlcStatus;
  if (!status) return null;
  if (status === 'member') {
    return `${stateName} is a Nurse Licensure Compact member. The compact covers the RN license beneath your APRN credential; the APRN license itself is still issued by ${stateName}.`;
  }
  if (status === 'pending') {
    return `${stateName} has enacted the Nurse Licensure Compact but has not implemented it, so plan on a ${stateName} RN license by endorsement.`;
  }
  return `${stateName} is not a Nurse Licensure Compact member, so out-of-state RNs apply for a ${stateName} RN license by endorsement.`;
}

/** Predicate-style clause for descriptions: "{State} is {nlcShort}". */
export function nlcShort(status: NlcStatus): string {
  if (status === 'member') return 'a Nurse Licensure Compact member';
  if (status === 'pending') return 'has enacted but not implemented the Nurse Licensure Compact';
  return 'outside the Nurse Licensure Compact';
}

/** Verb phrase for "{State} {phrase} the Nurse Licensure Compact" (salary S1). */
export function nlcMembershipPhrase(status: NlcStatus): string {
  if (status === 'member') return 'is a member of';
  if (status === 'pending') return 'has enacted but not yet implemented';
  return 'is not a member of';
}

/** Title-string form for the license guide title (LIC-meta). */
export function nlcTitleShort(status: NlcStatus): string {
  if (status === 'member') return 'Compact State';
  if (status === 'pending') return 'Compact Pending';
  return 'Non-Compact State';
}

/** "{State} NP License Guide: Restricted Practice, Compact State" (LIC-meta). */
export function buildLicenseGuideTitle(env: PracticeEnvironment): string {
  return `${env.stateName} ${brand.niche.short} License Guide: ${AUTHORITY_TITLE[env.authority]}, ${nlcTitleShort(env.nlcStatus)}`;
}

/** License guide meta description; the board clause is dropped past 160 characters. */
export function buildLicenseGuideDescription(env: PracticeEnvironment): string {
  const credential = brand.niche.short;
  const base = `How to get ${indefiniteArticle(credential)} ${credential} license in ${env.stateName}: ${env.authorityShort}, ${nlcShort(env.nlcStatus)}`;
  const withBoard = `${base}, and the APRN application through the ${env.boardName}.`;
  return withBoard.length <= 160 ? withBoard : `${base}.`;
}

/**
 * Published guide slugs, fetched once per request. The blog module is
 * imported lazily so this file stays free of the Supabase client at import
 * time (every other export here is pure). A failed read yields an empty set,
 * which means "link nothing", never a dead link.
 */
const getPublishedGuideSlugs = cache(async (): Promise<ReadonlySet<string>> => {
  try {
    const { getAllPublishedSlugs } = await import('@/lib/blog');
    const rows = await getAllPublishedSlugs();
    return new Set(rows.map((row) => row.slug));
  } catch (error) {
    console.error('[practice-environment] published slug lookup failed:', error);
    return new Set();
  }
});

/** True when the state's license guide is in getAllPublishedSlugs(). */
export async function isLicenseGuideLive(stateSlug: string): Promise<boolean> {
  const slugs = await getPublishedGuideSlugs();
  return slugs.has(licenseGuideSlug(stateSlug));
}

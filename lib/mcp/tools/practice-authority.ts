import {
  getAanpTierDefinition,
  getAuthorityLabel,
  getStatePracticeAuthority,
  type PracticeAuthority,
} from '@/lib/state-practice-authority';
import type { PracticeAuthorityInfo } from '@/lib/mcp/widgets/src/contracts';

/**
 * A state's practice authority as NP Hiring's own pages give it, from the
 * verified 51-jurisdiction dataset (lib/state-practice-authority.ts). The
 * tier is AANP's and is attributed to AANP. What the state requires comes
 * from the state's own `details`, never from the tier's definition, and
 * never from a label that names a rule: a tier is not a state rule (see the
 * note on getAanpTierDefinition). The dataset's `description` is never
 * shown (lib/pseo/practice-environment.ts).
 */

export const AANP_SOURCE = 'AANP State Practice Environment';
export const AANP_SOURCE_URL = 'https://www.aanp.org/advocacy/state/state-practice-environment';

const TONE: Readonly<Record<PracticeAuthority, PracticeAuthorityInfo['tone']>> = {
  full: 'open',
  reduced: 'conditional',
  restricted: 'restricted',
};

/** The card's line for a state, or null where the dataset has no entry. */
export function practiceAuthorityFor(stateName: string | null): PracticeAuthorityInfo | null {
  if (!stateName) return null;
  const info = getStatePracticeAuthority(stateName);
  if (!info) return null;
  return { state: stateName, level: info.authority, label: getAuthorityLabel(info.authority), tone: TONE[info.authority] };
}

export interface PracticeAuthorityAnswer extends PracticeAuthorityInfo {
  details: string;
  tierDefinition: string;
}

/** Everything get_practice_authority says about a state, or null where the dataset has no entry. */
export function practiceAuthorityAnswer(stateName: string): PracticeAuthorityAnswer | null {
  const info = getStatePracticeAuthority(stateName);
  if (!info) return null;
  return {
    state: stateName,
    level: info.authority,
    label: getAuthorityLabel(info.authority),
    tone: TONE[info.authority],
    details: info.details,
    tierDefinition: getAanpTierDefinition(info.authority),
  };
}

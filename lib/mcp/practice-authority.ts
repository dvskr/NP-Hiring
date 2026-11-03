/**
 * get_state_practice_authority: the board's verified 51-jurisdiction dataset
 * (lib/state-practice-authority.ts), answered the way its own pages answer
 * it. The tier is AANP's, attributed to AANP; what the state requires comes
 * from the state's own `details`, never from the tier definition (see the
 * long note on getAanpTierDefinition).
 */
import { brand } from '@/config/brand';
import {
    getAanpTierDefinition,
    getAuthorityLabel,
    getStatePracticeAuthority,
    type PracticeAuthority,
} from '@/lib/state-practice-authority';
import { resolveState } from '@/lib/mcp/jobs';

export const AANP_SOURCE = 'AANP State Practice Environment';
export const AANP_SOURCE_URL = 'https://www.aanp.org/advocacy/state/state-practice-environment';

export interface PracticeAuthorityAnswer {
    state: string;
    authority: PracticeAuthority;
    label: string;
    details: string;
    tierDefinition: string;
    source: string;
    sourceUrl: string;
}

export function practiceAuthorityFor(stateArg: string): PracticeAuthorityAnswer | string {
    const state = resolveState(stateArg);
    if (!state) return `"${stateArg}" is not a US state. Use a state name or its two-letter code.`;
    const info = getStatePracticeAuthority(state.name);
    if (!info) return `${brand.name} has no practice authority entry for ${state.name}.`;
    return {
        state: state.name,
        authority: info.authority,
        label: getAuthorityLabel(info.authority),
        details: info.details,
        tierDefinition: getAanpTierDefinition(info.authority),
        source: AANP_SOURCE,
        sourceUrl: AANP_SOURCE_URL,
    };
}

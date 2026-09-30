/**
 * lib/salary-guide-occupation-wages.ts: cited national wages for the two
 * APRN roles the salary guide covers that are NOT the board's niche role
 * (indexing audit CQ-09, plan FB-2).
 *
 * Nurse anesthetists and nurse midwives have their own federal occupation
 * codes, so the all-NP median in lib/stats-sources.ts (29-1171) never
 * describes their pay. Before this file their specialty pages carried the
 * title "Pay and Top States" while saying "No national CNM wage figure is
 * cited on this board". Each entry below is the BLS OEWS national median
 * annual wage for that occupation, in the StatSource shape so every surface
 * renders the same value, source and vintage.
 *
 * VERIFIED 2026-09-28 on bls.gov, two ways that agree:
 *   1. Occupational Outlook Handbook, "Nurse Anesthetists, Nurse Midwives,
 *      and Nurse Practitioners", Pay tab (last modified August 27, 2026):
 *      nurse anesthetists $236,590 and nurse midwives $134,040 in May 2025.
 *   2. OEWS news release Table 1 (national employment and wage data by
 *      occupation, May 2025): median hourly wage $113.75 (29-1151) and
 *      $64.44 (29-1161), which at 2,080 hours reproduce both annual medians.
 *
 * Update protocol (same as lib/stats-sources.ts): pull the new release from
 * the OOH Pay tab, confirm it against the OEWS Table 1 median hourly wage,
 * then update value, formatted, source and asOf together.
 */
import type { StatSource } from '@/lib/stats-sources';

/** A cited occupation-level wage: a StatSource plus the occupation it covers. */
export interface OccupationWageSource extends StatSource {
    /** BLS Standard Occupational Classification code, e.g. '29-1161'. */
    soc: string;
    /** The BLS occupation title in plural prose form, e.g. 'nurse midwives'. */
    occupation: string;
}

const OOH_PAY_URL =
    'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm#tab-5';

const VINTAGE_NOTE =
    'Verified 2026-09-28 against the OOH Pay tab (May 2025 figures, page last ' +
    'modified August 27, 2026) and the OEWS news release Table 1 median hourly ' +
    'wage times 2,080 hours. Both URLs show the LATEST release, so re-check them ' +
    'each spring when BLS publishes the next May reference period.';

export const OCCUPATION_WAGES = {
    /** Nurse Anesthetists (29-1151), national median annual wage. */
    nurseAnesthetists: {
        soc: '29-1151',
        occupation: 'nurse anesthetists',
        value: '236590',
        formatted: '$236,590',
        source: 'BLS OEWS, Nurse Anesthetists (29-1151), median annual wage, May 2025',
        sourceUrl: OOH_PAY_URL,
        asOf: '2025-05',
        vintageNote: VINTAGE_NOTE,
    },
    /** Nurse Midwives (29-1161), national median annual wage. */
    nurseMidwives: {
        soc: '29-1161',
        occupation: 'nurse midwives',
        value: '134040',
        formatted: '$134,040',
        source: 'BLS OEWS, Nurse Midwives (29-1161), median annual wage, May 2025',
        sourceUrl: OOH_PAY_URL,
        asOf: '2025-05',
        vintageNote: VINTAGE_NOTE,
    },
} as const satisfies Record<string, OccupationWageSource>;

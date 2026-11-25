/**
 * Figures and primary sources for the two definition guides,
 * /resources/what-is-a-nurse-practitioner and /resources/np-vs-pa.
 *
 * Not a route file. NP pay, NP growth and the full practice count are never
 * typed here: both guides read them from lib/stats-sources.ts. Everything
 * below was read from the primary source named beside it on
 * FACTS_CHECKED_ON. Nothing is estimated or rounded beyond what the source
 * prints.
 *
 * REFRESH RULE. These figures share a vintage with lib/stats-sources.ts:
 *   - PA pay comes from the same BLS OEWS release as
 *     STAT_SOURCES.npMedianWageBls (May 2025), so the two medians compare like
 *     for like. Read 2026-11-23 from the BLS public data API, series
 *     OEUN000000000000029107113 (national, all industries, annual median),
 *     and confirmed in BLS Employment Projections Table 1.3 and the
 *     Occupational Outlook Handbook, which print the same $135,880.
 *   - The employment counts come from the same Employment Projections cycle
 *     as STAT_SOURCES.blsGrowth2035 (2025 to 2035), read from Table 1.3 at
 *     STAT_SOURCES.blsGrowth2035.sourceUrl.
 * When either stats entry moves to a new release, re-read these from that
 * release in the same change. tests/seo/np-definition-pages-2026-11.test.ts
 * fails until the vintages agree again.
 */
import { STAT_SOURCES } from '@/lib/stats-sources';

/** The day every figure and fact in this file was read from its source. */
export const FACTS_CHECKED_ON = '2026-11-23';

export interface PrimarySource {
    readonly label: string;
    readonly url: string;
}

/** Primary sources both guides cite, by key. Labels carry no figures. */
export const PRIMARY_SOURCES = {
    consensusModel: {
        label: 'NCSBN, Consensus Model for APRN Regulation: Licensure, Accreditation, Certification and Education',
        url: 'https://www.ncsbn.org/public-files/Consensus_Model_for_APRN_Regulation_July_2008.pdf',
    },
    blsOohNp: {
        label: 'BLS Occupational Outlook Handbook, Nurse Anesthetists, Nurse Midwives, and Nurse Practitioners',
        url: 'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm',
    },
    blsOohRn: {
        label: 'BLS Occupational Outlook Handbook, Registered Nurses',
        url: 'https://www.bls.gov/ooh/healthcare/registered-nurses.htm',
    },
    blsOohPhysicians: {
        label: 'BLS Occupational Outlook Handbook, Physicians and Surgeons',
        url: 'https://www.bls.gov/ooh/healthcare/physicians-and-surgeons.htm',
    },
    blsOohPa: {
        label: 'BLS Occupational Outlook Handbook, Physician Assistants',
        url: 'https://www.bls.gov/ooh/healthcare/physician-assistants.htm',
    },
    blsPaWageSeries: {
        label: 'BLS public data API, OEWS national annual median wage for physician assistants',
        url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/OEUN000000000000029107113',
    },
    anccFnp: {
        label: 'ANCC, Family Nurse Practitioner Certification',
        url: 'https://www.nursingworld.org/our-certifications/family-nurse-practitioner/',
    },
    anccCertifications: {
        label: 'ANCC, Our Certifications',
        url: 'https://www.nursingworld.org/our-certifications/',
    },
    anccRenewals: {
        label: 'ANCC, Certification Renewals',
        url: 'https://www.nursingworld.org/certification/renewals/',
    },
    aanpcb: {
        label: 'American Academy of Nurse Practitioners Certification Board (AANPCB), operating as NPCB',
        url: 'https://www.aanpcert.org/',
    },
    aanpcbFnpHandbook: {
        label: 'AANPCB (NPCB), Family Nurse Practitioner Candidate Handbook',
        url: 'https://www.aanpcert.org/wp-content/uploads/FNP-Candidate-Handbook-06-04-2026.pdf',
    },
    aanpcbFaq: {
        label: 'AANPCB (NPCB), Certification FAQ',
        url: 'https://www.aanpcert.org/resources/faq/',
    },
    aacnDnp: {
        label: 'American Association of Colleges of Nursing (AACN), DNP Fact Sheet',
        url: 'https://www.aacnnursing.org/news-data/fact-sheets/dnp-fact-sheet',
    },
    nccpaCertify: {
        label: 'NCCPA, Become Certified',
        url: 'https://www.nccpa.net/become-certified/',
    },
    nccpaMaintain: {
        label: 'NCCPA, Maintain Certification',
        url: 'https://www.nccpa.net/maintain-certification/',
    },
} as const satisfies Record<string, PrimarySource>;

/**
 * BLS Employment Projections, Table 1.3 (fastest growing occupations, 2025
 * and projected 2035), released August 27, 2026. Same table and cycle as
 * STAT_SOURCES.blsGrowth2035, which carries the NP growth rate itself.
 */
export const BLS_PROJECTIONS = {
    sourceUrl: STAT_SOURCES.blsGrowth2035.sourceUrl,
    cycle: { from: '2025', to: '2035' },
    nursePractitioners: { jobsBase: '336,300', jobsProjected: '474,100', change: '137,800' },
    physicianAssistants: { jobsBase: '168,900', jobsProjected: '204,600', growth: '21%' },
} as const;

/**
 * Physician assistants (SOC 29-1071), national annual median wage, BLS
 * OEWS. `asOf` uses the STAT_SOURCES shape so the tests can hold it to the
 * same release as STAT_SOURCES.npMedianWageBls.
 */
export const PA_MEDIAN_WAGE = {
    value: '135880',
    formatted: '$135,880',
    asOf: '2025-05',
    sourceUrl: PRIMARY_SOURCES.blsPaWageSeries.url,
} as const;

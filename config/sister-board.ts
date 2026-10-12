/**
 * Sister board: PMHNP Hiring (owner decision 2026-10-12).
 *
 * NP Hiring covers every NP specialty. PMHNP Hiring, run by the same company
 * (Akari Labs LLC), lists psychiatric mental health NP jobs only. Job seekers
 * who want only those roles, and employers hiring for them, are pointed there
 * from three places: a homepage band, the psychiatric category landing, and a
 * hint under the post-job specialty select.
 *
 * Every literal for the sister board lives here because config/ is the one
 * folder the niche-copy and brand-leak scanners skip
 * (tests/regressions/brand-leak-scan.ts). Code reads these tokens through
 * lib/sister-board.ts and never spells the name or domain itself.
 *
 * COPY RULES (pinned by tests/regressions/sister-board.test.ts):
 *   - House style: no em or en dash, no spaced hyphen.
 *   - No figures. The sister board charges per post while this board runs a
 *     promo, and its prices change, so neither prices nor counts appear here.
 *   - Never call the sister board free. Employers are told to post on BOTH
 *     boards (owner's pick), never to leave this one.
 */

import { brand } from './brand';

export type SisterBoardPath = 'jobs' | 'employers';

export type SisterBoardCampaign = 'homeSeekers' | 'homeEmployers' | 'hub' | 'postJob';

interface SisterBoardCard {
    chip: string;
    title: string;
    desc: string;
    action: string;
}

export interface SisterBoardConfig {
    name: string;
    /** Origin only, no trailing slash. */
    baseUrl: string;
    paths: Record<SisterBoardPath, string>;
    /**
     * The sister middleware strips utm tags from the URL but keeps source,
     * medium and campaign in an attribution cookie when each is a plain slug
     * (letters, digits, dot, underscore, hyphen). utm_content is dropped, so
     * the placement goes in the campaign.
     */
    utm: { source: string; medium: string };
    campaigns: Record<SisterBoardCampaign, string>;
    copy: {
        home: {
            eyebrow: string;
            heading: string;
            lede: string;
            seekerCard: SisterBoardCard;
            employerCard: SisterBoardCard;
        };
        hub: { heading: string; body: string; action: string };
        postJob: { body: string; action: string };
    };
}

const NAME = 'PMHNP Hiring';
/** This board's name, from config/brand.ts, so a fork never inherits "NP Hiring". */
const HOME = brand.name;

export const sisterBoard: SisterBoardConfig = {
    name: NAME,
    baseUrl: 'https://pmhnphiring.com',
    paths: {
        jobs: '/jobs',
        // The employer landing, not /post-job: that route is a login wall for
        // visitors without an employer account.
        employers: '/for-employers',
    },
    utm: { source: 'nphiring', medium: 'referral' },
    campaigns: {
        homeSeekers: 'sister-home-seekers',
        homeEmployers: 'sister-home-employers',
        hub: 'sister-psych-hub',
        postJob: 'sister-post-job',
    },
    copy: {
        home: {
            eyebrow: 'Our sister board',
            heading: 'Only looking for psychiatric NP roles?',
            // "Built only for" mirrors the sister board's own positioning (its
            // hero reads as a board for this one specialty) without promising
            // that every aggregated listing is classified perfectly.
            lede: `${HOME} covers every nurse practitioner specialty, psychiatry included. ${NAME}, our sister board, is built only for psychiatric mental health nurse practitioner jobs.`,
            seekerCard: {
                chip: 'Job seekers',
                title: `Browse PMHNP jobs on ${NAME}`,
                desc: 'The whole board is built around psychiatric mental health nurse practitioner roles, so you can skip the specialty filter.',
                action: `Visit ${NAME}`,
            },
            employerCard: {
                chip: 'Employers',
                title: 'Hiring a PMHNP? Post on both boards',
                desc: `Post the role here on ${HOME}, then list it on ${NAME} as well to reach candidates who search for psychiatric roles only.`,
                action: 'See employer options',
            },
        },
        hub: {
            heading: 'Only want psychiatric roles?',
            body: `${NAME}, our sister board, is built only for psychiatric mental health nurse practitioner jobs.`,
            action: `Browse ${NAME}`,
        },
        postJob: {
            body: `Hiring a psychiatric NP? Post this role here on ${HOME}, and list it on ${NAME} as well, our sister board for psychiatric mental health nurse practitioners.`,
            action: `Post on ${NAME}`,
        },
    },
};

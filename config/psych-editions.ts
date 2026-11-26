/**
 * The psychiatric NP editions in this board's guides store (owner decision
 * 2026-11-26): the sister board's six career guides for psychiatric mental
 * health nurse practitioners, and a library of all six, sold here through
 * this board's own claim, checkout, library and downloads instead of a link
 * to the sister board's store.
 *
 * Every literal that names the specialty or the sister board lives here,
 * because config/ is the one folder the niche-copy and brand-leak scanners
 * skip (tests/regressions/brand-leak-scan.ts). The figures stay in
 * lib/guides/catalog.ts, the store's one price source: each edition's price
 * and page count. The guide copy is the sister board's own, word for word, so
 * this store and the PDF say the same thing.
 *
 * The same guides are on the sister board's store. Each edition's page here
 * names that board's page for the same guide as its canonical
 * (lib/guides/canonical.ts), so the two never compete in search.
 *
 * COPY RULES (pinned by tests/lib/guides-psych-editions.test.ts):
 *   - House style: no em or en dash, no spaced hyphen.
 *   - The shelf, card and label copy names no price and never says free:
 *     the price block of the phase (lib/guides/phase.ts) says that.
 *   - The card on the job pages never names the sister board: those pages'
 *     donor copy guard reads every word outside a data-sister-board block.
 */

import { sisterBoard } from './sister-board';

/** One edition's copy. Its slug, price and page count are in lib/guides/catalog.ts. */
export interface PsychEditionCopy {
    readonly title: string;
    readonly subtitle: string;
    /**
     * The PDF's file name in the sister board's guides folder, and the name
     * readers download it under. The file goes in the storage bucket under
     * this store's slug (lib/guides/storage.ts).
     */
    readonly sourceFile: string;
    readonly audience: string;
    readonly summary: string;
    readonly contents: readonly string[];
    /** The same guide's slug on the sister board's store: its page there is the canonical of this edition's page. */
    readonly sisterSlug: string;
}

/** The library bundle's copy. Its price is in lib/guides/catalog.ts. */
export interface PsychLibraryCopy {
    readonly title: string;
    readonly subtitle: string;
    readonly audience: string;
    readonly summary: string;
    /** The sister board's bundle of the same six guides: the canonical of the library's page. */
    readonly sisterSlug: string;
}

export interface PsychEditionsConfig {
    readonly guides: {
        readonly 'psych-compensation-report': PsychEditionCopy;
        readonly 'psych-first-year-playbook': PsychEditionCopy;
        readonly 'psych-interview-prep-pack': PsychEditionCopy;
        readonly 'psych-negotiation-guide': PsychEditionCopy;
        readonly 'psych-telepsychiatry-playbook': PsychEditionCopy;
        readonly 'psych-launch-your-practice': PsychEditionCopy;
    };
    readonly library: PsychLibraryCopy;
    readonly labels: {
        /** The chip on an edition's product page. */
        readonly edition: string;
        /** The page title's suffix after the product title. */
        readonly guideKind: string;
        readonly bundleKind: string;
        /** The share card's second line. */
        readonly ogGuide: string;
        readonly ogBundle: string;
    };
    /** The shelf on /guides, right after the hero, and the hero's pointer to it. */
    readonly store: {
        readonly eyebrow: string;
        readonly heading: string;
        readonly lede: string;
        readonly jump: string;
        readonly libraryLink: string;
    };
    /** Who wrote the editions: on the shelf and each edition's page, inside a data-sister-board block. */
    readonly attribution: string;
    /** The card on the sister board's specialty pages: first in the sidebar, or first in the listings on a phone. */
    readonly card: {
        readonly eyebrow: string;
        readonly heading: string;
        readonly body: string;
        readonly action: string;
        readonly inlineAction: string;
    };
}

export const psychEditions: PsychEditionsConfig = {
    guides: {
        'psych-compensation-report': {
            title: '2026 PMHNP Compensation Report',
            subtitle: 'What psychiatric NPs earn by state, setting and pay model',
            sourceFile: 'pmhnphiring-2026-pmhnp-compensation-report.pdf',
            audience: 'Any PMHNP or student who wants the market numbers before a job search, a raise or a rate decision.',
            summary: 'Pay for psychiatric NPs from BLS, AANP and live postings, with a state-by-state table for all 50 states and DC, W-2 vs. 1099 math and a negotiation method built on the data.',
            contents: [
                'Methodology and source hierarchy',
                'National pay distribution',
                'State-by-state pay table (50 states and DC)',
                'Specialty and setting',
                'Telehealth vs. in-person pay',
                'W-2 vs. 1099 pay',
                'RVU and productivity pay',
                'New graduate vs. experienced pay',
                'Job outlook and five market risks',
                'How to use this data in negotiation',
                'Sources and update log',
            ],
            sisterSlug: 'compensation-report',
        },
        'psych-first-year-playbook': {
            title: 'First-Year PMHNP Playbook',
            subtitle: 'Boards, your first job, collaborative agreements and surviving year one',
            sourceFile: 'pmhnphiring-first-year-pmhnp-playbook.pdf',
            audience: 'Final-semester PMHNP students, new graduates waiting on boards, and PMHNPs in their first year of practice.',
            summary: 'The order of operations from graduation to your first prescription, the exam choice, the job filters and the checklists to get through year one with every hour counted.',
            contents: [
                'Graduation to license in the right order',
                'Choosing and passing your board exam',
                'Practice authority, transition hours and a five-year plan',
                'Green flags and red flags in your first job search',
                'Collaborative agreements',
                'Your first 90 days clinically',
                'Your credential stack and CE plan',
                'Your first-year pay and what new grads earn',
                'The year-one checklist',
            ],
            sisterSlug: 'first-year-playbook',
        },
        'psych-interview-prep-pack': {
            title: 'PMHNP Interview Prep Pack',
            subtitle: 'Questions with model answers for psychiatric NP and telepsychiatry interviews',
            sourceFile: 'pmhnphiring-pmhnp-interview-prep-pack.pdf',
            audience: 'New-grad PMHNPs preparing for a first job, and experienced PMHNPs interviewing with telepsychiatry platforms, group practices, community mental health or inpatient units.',
            summary: 'Ten psychiatric clinical scenarios with full model answers, twelve behavioral questions with a STAR worksheet, and a seven-day mock interview plan.',
            contents: [
                'How PMHNP interviews are structured',
                'Behavioral questions and the STAR worksheet',
                'Clinical scenarios with model answers (10 full answers plus 18 practice prompts)',
                'Telepsychiatry platform interview questions',
                'Regulatory and ethics questions',
                'Questions to ask the employer',
                'Mock interview plan and day-before checklist',
            ],
            sisterSlug: 'interview-prep-pack',
        },
        'psych-negotiation-guide': {
            title: 'Negotiate Like a PMHNP',
            subtitle: 'Scripts, offer math and contract red flags for psychiatric NPs',
            sourceFile: 'pmhnphiring-negotiate-like-a-pmhnp.pdf',
            audience: 'PMHNPs weighing a first offer, a job change, a 1099 telepsychiatry contract or a raise after year one.',
            summary: 'The data, the math and the exact words to move an offer toward the top of the range, with a 1099 vs. W-2 calculator and a 20-point contract red-flag audit.',
            contents: [
                'Know your number: market anchors for psychiatric NPs',
                'Total compensation, not salary',
                'Pay models decoded: salary, hourly, per visit, wRVU and collections',
                'The 1099 vs. W-2 calculator',
                'The offer comparison worksheet',
                'Negotiation scripts, word for word',
                'The 20-point contract red-flag audit and non-compete law in 2026',
                'Renegotiating after year one',
                'Sources and update log',
            ],
            sisterSlug: 'negotiate-like-a-pmhnp',
        },
        'psych-telepsychiatry-playbook': {
            title: 'The Telepsychiatry NP Playbook',
            subtitle: 'Multistate licensing, DEA rules, 1099 vs. W-2 and setting your rate (2026 to 2027)',
            sourceFile: 'pmhnphiring-telepsychiatry-np-playbook.pdf',
            audience: 'PMHNPs who work for a telepsychiatry platform, plan to join one, or want to run their own multistate telehealth practice.',
            summary: 'How to license across states, register with DEA, prescribe controlled substances over video before and after January 1, 2027, bill correctly, judge a platform job and price your time.',
            contents: [
                'The 2026 to 2027 telepsychiatry rulebook in one page',
                'Licensing across state lines',
                'Choosing your first three states (scoring worksheet)',
                'Adding a state license, step by step',
                'Prescriptive authority, furnishing numbers and state controlled-substance registrations',
                'DEA registration strategy for multistate practice',
                'Controlled-substance telehealth now and on January 1, 2027',
                'Medicare, Medicaid and commercial telehealth billing',
                'Telepsychiatry platforms, pay models and due diligence',
                'The 1099 vs. W-2 rate calculator',
                'Compliance setup for a home telehealth office',
                'Contract red flags for telehealth roles',
                'Checklists and templates',
            ],
            sisterSlug: 'telepsychiatry-playbook',
        },
        'psych-launch-your-practice': {
            title: 'Launch Your PMHNP Practice',
            subtitle: 'The 2026 toolkit for private psychiatric practice: templates, credentialing, EHRs and billing',
            sourceFile: 'pmhnphiring-launch-your-pmhnp-practice.pdf',
            audience: 'Board-certified PMHNPs who want to own a solo or small-group psychiatric practice, in person, by telehealth or both.',
            summary: 'A 120-day launch timeline with the forms, costs, billing codes and templates for each step, from choosing your entity to your first claim.',
            contents: [
                'Can you own a practice in your state?',
                'Choosing your legal entity',
                'The 120-day launch timeline',
                'Identifiers and registrations',
                'Credentialing and payer enrollment',
                'Malpractice insurance for a practice owner',
                'HIPAA and your compliance program',
                'Choosing an EHR for psychiatric prescribing',
                'Billing and coding primer for psychiatric services',
                'Cash-pay, insurance or hybrid',
                'Startup budget and break-even worksheet',
                'Collaborative agreements for owners in reduced and restricted states',
                'Templates you can copy',
            ],
            sisterSlug: 'launch-your-practice',
        },
    },
    library: {
        title: 'Psychiatric NP Library',
        subtitle: 'All six psychiatric NP guides',
        audience: 'Every PMHNP, from final semester to practice owner.',
        summary: 'Every psychiatric NP edition: the pay data, the first-year roadmap, interview answers, negotiation scripts, the telepsychiatry rules and the practice launch toolkit.',
        // The sister board sells the same six guides as its Complete Library.
        sisterSlug: 'complete-library',
    },
    labels: {
        edition: 'Psychiatric NP edition',
        guideKind: 'Psychiatric NP Career Guide',
        bundleKind: 'Psychiatric NP Guide Bundle',
        ogGuide: 'Career guide for psychiatric NPs',
        ogBundle: 'Guide bundle for psychiatric NPs',
    },
    store: {
        eyebrow: 'Psychiatric NP editions',
        heading: 'Guides written for psychiatric NPs',
        lede: 'PDF guides for psychiatric mental health nurse practitioners: pay data, your first year, interviews, negotiation, telepsychiatry and starting a practice. They open in the same library as every guide here.',
        jump: 'Psychiatric NP? See the psychiatric NP editions',
        libraryLink: 'See every guide in the library',
    },
    attribution: `Written by ${sisterBoard.name}, our sister board for psychiatric NP jobs.`,
    card: {
        eyebrow: 'Career guides',
        heading: 'Guides for psychiatric NPs',
        body: 'PDF guides written for psychiatric mental health nurse practitioners: pay data, interviews, negotiation, telepsychiatry and starting a practice.',
        action: 'See the Psychiatric NP Library',
        inlineAction: 'See the psychiatric NP guides',
    },
};

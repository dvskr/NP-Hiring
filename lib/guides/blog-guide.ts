import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import type { OwnGuideSlug } from '@/lib/guides/catalog';

/**
 * Blog posts that link one guide's preview page in a sentence of their own,
 * the way lib/guides/job-guide.ts picks the guide for a job page. Posts are
 * blog_posts rows (or the code copy in content/blog), so the sentence lives
 * here and the post template renders it right after the article; no row
 * changes.
 *
 * One link per post, on a phrase that names what the guide page holds (the
 * search its preview answers), and no figures, no price and no phase copy,
 * so neither a new edition nor the end of the free period leaves a sentence
 * stale. A post on two guides' topics links the one it fits best. Every
 * state license guide (np-license-<state>) links the multistate licensing
 * chapter, since each covers one state's license.
 */
export interface BlogGuideMention {
    readonly guide: OwnGuideSlug;
    /** One sentence; `phrase` inside it links to /guides/{guide}. */
    readonly text: string;
    readonly phrase: string;
}

const COMPENSATION = 'nurse practitioner compensation report';
const COLLABORATIVE = 'collaborative agreements for new NPs';
const INTERVIEW = 'nurse practitioner interview questions and answers PDF';
const NEGOTIATION = 'nurse practitioner contract negotiation';
const MULTISTATE = 'how to get an NP license in multiple states';
const CLINIC = 'how to open your own clinic as a nurse practitioner';

export const BLOG_GUIDE_MENTIONS: Readonly<Record<string, BlogGuideMention>> = {
    'highest-paying-np-specialties': {
        guide: 'compensation-report',
        text: `For AANP's specialty figures beside BLS pay by work setting, with the source behind each one, read the summary of our ${COMPENSATION}.`,
        phrase: COMPENSATION,
    },
    'np-salary-guide': {
        guide: 'compensation-report',
        text: `To see where an offer sits on the national pay curve, read the summary and methodology of our ${COMPENSATION}.`,
        phrase: COMPENSATION,
    },
    'nurse-practitioner-job-outlook': {
        guide: 'compensation-report',
        text: `Our ${COMPENSATION} sets the BLS growth projection beside pay by state, specialty and setting, with the source behind each figure.`,
        phrase: COMPENSATION,
    },

    'new-grad-np-first-job': {
        guide: 'first-year-playbook',
        text: `Before you sign a first offer, read the chapter of our First-Year NP Playbook on ${COLLABORATIVE}: where you need one, what to pay and the terms to check.`,
        phrase: COLLABORATIVE,
    },
    'how-to-become-a-nurse-practitioner': {
        guide: 'first-year-playbook',
        text: `For the year after boards, from your first license to your first contract, start with the chapter on ${COLLABORATIVE} from our First-Year NP Playbook.`,
        phrase: COLLABORATIVE,
    },
    'np-certification-overview': {
        guide: 'first-year-playbook',
        text: `Passed the exam? The next step is your first contract: read the chapter on ${COLLABORATIVE} from our First-Year NP Playbook.`,
        phrase: COLLABORATIVE,
    },
    'np-fellowship-residency-programs': {
        guide: 'first-year-playbook',
        text: `Taking a first job instead of a fellowship? Read the green and red flags of a first job and ${COLLABORATIVE}, from our First-Year NP Playbook.`,
        phrase: COLLABORATIVE,
    },

    'np-interview-questions': {
        guide: 'interview-prep-pack',
        text: `For how each round runs, from the recruiter screen to the telehealth mock visit, read the first chapter of our ${INTERVIEW}.`,
        phrase: INTERVIEW,
    },
    'np-resume-guide': {
        guide: 'interview-prep-pack',
        text: `Once your resume lands the call, prepare round by round with the first chapter of our ${INTERVIEW}.`,
        phrase: INTERVIEW,
    },
    'np-cover-letter-guide': {
        guide: 'interview-prep-pack',
        text: `When your letter gets you a call, the first chapter of our ${INTERVIEW} shows what each interview round tests.`,
        phrase: INTERVIEW,
    },

    'np-salary-negotiation-guide': {
        guide: 'negotiate-like-an-np',
        text: `Before you counter, set your walk-away, target and ask and price every benefit with our guide to ${NEGOTIATION}.`,
        phrase: NEGOTIATION,
    },
    'np-1099-vs-w2': {
        guide: 'negotiate-like-an-np',
        text: `To price what a 1099 contract leaves you to cover, read the total compensation chapter of our guide to ${NEGOTIATION}.`,
        phrase: NEGOTIATION,
    },
    'nurse-practitioner-noncompete-laws': {
        guide: 'negotiate-like-an-np',
        text: `A non-compete is one clause among many: our guide to ${NEGOTIATION} shows how to price the rest of the offer.`,
        phrase: NEGOTIATION,
    },
    'np-malpractice-insurance-guide': {
        guide: 'negotiate-like-an-np',
        text: `Who pays the tail is a term you can negotiate: our guide to ${NEGOTIATION} prices it with the rest of the package.`,
        phrase: NEGOTIATION,
    },

    'remote-telehealth-np-jobs-guide': {
        guide: 'telehealth-playbook',
        text: `Licensed in one state and adding more? Read the chapter of our Telehealth NP Playbook on ${MULTISTATE}.`,
        phrase: MULTISTATE,
    },
    'aprn-compact-states': {
        guide: 'telehealth-playbook',
        text: `Until the compact is live, each state takes its own license: see ${MULTISTATE}, from our Telehealth NP Playbook.`,
        phrase: MULTISTATE,
    },

    'np-credentialing-checklist': {
        guide: 'launch-your-practice',
        text: `Credentialing your own clinic rather than joining one? Start with ${CLINIC}, from Launch Your NP Practice.`,
        phrase: CLINIC,
    },
    'what-is-an-aprn': {
        guide: 'launch-your-practice',
        text: `Thinking of practicing on your own? See ${CLINIC}, from the first chapter of Launch Your NP Practice.`,
        phrase: CLINIC,
    },
};

/** The sentence every state license guide carries. */
export const LICENSE_GUIDE_MENTION: BlogGuideMention = {
    guide: 'telehealth-playbook',
    text: `Practicing in more than one state? See ${MULTISTATE}, from our Telehealth NP Playbook.`,
    phrase: MULTISTATE,
};

/** The guide mention a post carries after its article, or null. */
export function guideMentionForPost(slug: string): BlogGuideMention | null {
    if (Object.hasOwn(BLOG_GUIDE_MENTIONS, slug)) return BLOG_GUIDE_MENTIONS[slug];
    return LICENSE_GUIDE_SLUG_REGEX.test(slug) ? LICENSE_GUIDE_MENTION : null;
}

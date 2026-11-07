import type { GuideSlug } from '@/lib/guides/catalog';

/** The parts of a job that decide which guide helps its reader next. */
export interface JobGuideSignals {
    readonly newGradFriendly?: boolean | null;
    readonly isRemote?: boolean | null;
    readonly mode?: string | null;
    readonly jobType?: string | null;
    /** The posting title, read only for a "1099" contract marker. */
    readonly title?: string | null;
}

export interface JobGuidePick {
    readonly slug: GuideSlug;
    readonly heading: string;
    readonly pitch: string;
}

const MARKS_1099 = /\b1099\b/;

/** A contract role: the Contract job type, or a 1099 marker in the job type or title. */
function isContractJob(job: JobGuideSignals): boolean {
    const jobType = job.jobType?.toLowerCase() ?? '';
    return jobType === 'contract' || MARKS_1099.test(jobType) || MARKS_1099.test(job.title ?? '');
}

/**
 * The guide shown on a job page. A new grad needs the first-year guide
 * whatever the setting; a remote or telehealth role, the telehealth rules; a
 * contract or 1099 role, the offer math; anyone else, interview prep, the
 * step after applying.
 */
export function guideForJob(job: JobGuideSignals): JobGuidePick {
    const mode = job.mode?.toLowerCase() ?? '';
    if (job.newGradFriendly) {
        return {
            slug: 'first-year-playbook',
            heading: 'Is this your first NP job?',
            pitch: 'Green and red flags in a first job, collaborative agreements, your first 90 days and a year-one checklist.',
        };
    }
    if (job.isRemote || mode.includes('telehealth') || mode.includes('remote')) {
        return {
            slug: 'telehealth-playbook',
            heading: 'Applying for a telehealth role?',
            pitch: 'Licensing across state lines, DEA registration, the telehealth prescribing rules for 2027 and how to judge a platform job.',
        };
    }
    if (isContractJob(job)) {
        return {
            slug: 'negotiate-like-an-np',
            heading: 'Weighing a contract offer?',
            pitch: 'A 1099 vs. W-2 calculator, every pay model decoded and a 20-point contract red-flag audit.',
        };
    }
    return {
        slug: 'interview-prep-pack',
        heading: 'Get ready for the interview',
        pitch: 'Twelve clinical scenarios with model answers, behavioral questions with a STAR worksheet and a seven-day mock interview plan.',
    };
}

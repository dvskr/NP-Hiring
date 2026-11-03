/**
 * Every word the widget shows, in one place. Owner copy rules: professional
 * English; no em dash, en dash or spaced hyphen; no helper or narration lines.
 * tests/mcp/widgets/copy.test.ts scans this folder for the forbidden dashes.
 */
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from '../../tool-names';
import { daysAgo, formatCount, formatMonthDay } from './format';

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export const COPY = {
    back: 'Back',
    details: 'Details',
    easyApply: 'Easy Apply',
    apply: 'Apply',
    seeAll: 'See all',
    showMoreJobs: 'Show more jobs',
    seeAllOnSite: 'See all on NP Hiring',
    noJobs: 'No jobs match this search.',
    previous: 'Previous',
    next: 'Next',
    newGradWelcome: 'New grad welcome',
    factPay: 'Pay',
    factSchedule: 'Schedule',
    factWorkMode: 'Work mode',
    factSetting: 'Setting',
    factPatients: 'Patients',
    factExperience: 'Experience',
    factPosted: 'Posted',
    benefits: 'Benefits',
    showMore: 'Show more',
    showLess: 'Show less',
    save: 'Save',
    saved: 'Saved',
    viewOnSite: 'View on NP Hiring',
    continueOnEmployerSite: 'Continue on employer site',
    addedToMyApplications: 'Added to My applications',
    resume: 'Resume',
    /** A resume is on the profile but the server sent no file name for it. */
    resumeOnFile: 'On file',
    noResume: 'No resume on your profile',
    addResume: 'Add a resume on NP Hiring',
    coverLetter: 'Cover letter',
    chooseAnswer: 'Choose an answer',
    yes: 'Yes',
    no: 'No',
    privacyPolicy: 'Privacy Policy',
    submitApplication: 'Submit application',
    updateApplication: 'Update application',
    submitting: 'Submitting',
    questionRequired: 'This question is required.',
    applicationSent: 'Application sent',
    myApplications: 'My applications',
    openOnSite: 'Open on NP Hiring',
    withdraw: 'Withdraw',
    keep: 'Keep',
    withdrawQuestion: 'Withdraw this application?',
    noApplications: 'No applications yet.',
} as const;

/** The answer values a boolean screening question sends. */
export const BOOLEAN_ANSWERS = [COPY.yes, COPY.no] as const;

export function jobsCount(total: number): string {
    return total === 1 ? '1 job' : `${formatCount(total)} jobs`;
}

export function applicationsCount(total: number): string {
    return total === 1 ? '1 application' : `${formatCount(total)} applications`;
}

/** Pay with a leading "~" when the figure is an estimate. */
export function payLabel(pay: string | null, isEstimate: boolean): string | null {
    if (!pay) return null;
    return isEstimate ? `~${pay}` : pay;
}

export function experienceLabel(newGradFriendly: boolean, experience: string | null): string | null {
    return newGradFriendly ? COPY.newGradWelcome : experience;
}

/** "Posted today", "Posted yesterday", "Posted 3 days ago", then "Posted Sep 12" past 30 days. */
export function postedLabel(iso: string, now: Date, timeZone?: string): string | null {
    const days = daysAgo(iso, now, timeZone);
    if (days === null) return null;
    if (days === 0) return 'Posted today';
    if (days === 1) return 'Posted yesterday';
    if (days <= 30) return `Posted ${days} days ago`;
    const date = formatMonthDay(iso, timeZone);
    return date ? `Posted ${date}` : null;
}

/** The Posted fact on the detail view: "Today", "Yesterday", "3 days ago" or "Sep 12". */
export function postedValue(iso: string, now: Date, timeZone?: string): string | null {
    const days = daysAgo(iso, now, timeZone);
    if (days === null) return null;
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 30) return `${days} days ago`;
    return formatMonthDay(iso, timeZone);
}

export function statusLabel(status: ApplicationStatus): string {
    return APPLICATION_STATUS_LABELS[status];
}

export function applyHeading(title: string): string {
    return `Apply to ${title}`;
}

export function employerLine(employer: string, location: string): string {
    return location ? `${employer} · ${location}` : employer;
}

export function appliedStatusLine(date: string, label: string): string {
    return `You applied on ${date}. Status: ${label}.`;
}

export function counterLabel(length: number, max: number): string {
    return `${formatCount(length)} of ${formatCount(max)}`;
}

export function jobAtEmployer(title: string, employer: string): string {
    return `${title} at ${employer}`;
}

export function appliedOn(date: string): string {
    return `Applied ${date}`;
}

export function updatedOn(date: string): string {
    return `Updated ${date}`;
}

export function summaryChipLabel(label: string, count: number): string {
    return `${label} ${formatCount(count)}`;
}

/** The site's own withdraw warning (app/my-applications), with the job title. */
export function withdrawWarning(title: string): string {
    return (
        `The employer still sees your application for ${title}, marked Withdrawn, with your name on it. ` +
        'Your cover letter text and resume are removed. A cover letter you uploaded as a file stays attached. ' +
        'This cannot be undone.'
    );
}

// Sentences for app.updateModelContext: what the candidate just did in the widget.

export function modelSubmitted(title: string, employer: string, resubmitted: boolean): string {
    return resubmitted
        ? `The user updated their application for ${title} at ${employer} on NP Hiring.`
        : `The user submitted an application for ${title} at ${employer} on NP Hiring.`;
}

export function modelWithdrew(title: string, employer: string): string {
    return `The user withdrew their application for ${title} at ${employer} on NP Hiring.`;
}

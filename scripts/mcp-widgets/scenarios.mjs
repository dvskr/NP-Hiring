/**
 * Every view and state the preview harness can show. host.mjs plays the host
 * side of a scenario (tool input, tool result, answers to the widget's own
 * tool calls); screenshots.mjs runs the `steps` in the widget frame before
 * taking the picture.
 *
 * A response is a tool result, 'pending' (never answers, to show a loading
 * state) or a function of the call's arguments.
 */
import {
    applicationsView,
    applyResultView,
    applyView,
    applyViewBlocked,
    applyViewExisting,
    fail,
    jobDetailView,
    jobListView,
    ok,
    secondPageView,
} from './fixtures.mjs';

const SEARCH_INPUT = { query: 'psychiatric', state: 'TX', min_salary: 120000 };
const JOB_INPUT = { job_id: 'job_abhp_outpatient' };

const fillRequired = [
    { check: { label: 'Yes' } },
    { select: { label: 'Which schedule do you prefer?', value: 'Four 10-hour days' } },
    { fill: { label: 'When could you start?', value: 'January 5, 2027' } },
    { check: { label: 'I consent to sharing my profile' } },
];

const listBase = { tool: 'search_jobs', input: SEARCH_INPUT, result: ok(jobListView()) };
const detailBase = { tool: 'get_job', input: JOB_INPUT, result: ok(jobDetailView()) };
const applyBase = { tool: 'start_application', input: JOB_INPUT, result: ok(applyView()) };
const applicationsBase = { tool: 'list_my_applications', input: {}, result: ok(applicationsView()) };

export const SCENARIOS = [
    { name: 'list', ...listBase, waitFor: '[data-view="job-list"]' },
    { name: 'list-skeleton', ...listBase, result: 'pending', waitFor: '[data-view="skeleton-job-list"]' },
    {
        name: 'list-empty',
        ...listBase,
        result: ok(
            jobListView({
                heading: 'Neonatal NP jobs in Alaska',
                filters: ['Neonatal', 'Alaska'],
                total: 0,
                totalPages: 0,
                jobs: [],
                nextPageArgs: null,
            }),
        ),
        waitFor: '[data-view="job-list"]',
    },
    {
        name: 'list-saved',
        tool: 'list_saved_jobs',
        input: {},
        result: ok(
            jobListView({
                heading: 'Saved jobs',
                filters: [],
                total: 2,
                totalPages: 1,
                jobs: jobListView().jobs.slice(0, 2).map((job) => ({ ...job, saved: true })),
                nextPageArgs: null,
                browseUrl: 'https://nphiring.com/saved-jobs',
            }),
        ),
        waitFor: '[data-view="job-list"]',
    },
    {
        name: 'list-more-loading',
        ...listBase,
        responses: { search_jobs: 'pending' },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Show more jobs' } }],
    },
    {
        name: 'list-more-loaded',
        ...listBase,
        responses: { search_jobs: ok(secondPageView()) },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Show more jobs' } }, { waitText: 'Consultation Liaison Psychiatric NP' }],
    },
    {
        name: 'list-more-error',
        ...listBase,
        responses: { search_jobs: fail('Search is busy right now. Try again in a moment.') },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Show more jobs' } }, { waitText: 'Search is busy right now.' }],
    },
    {
        name: 'list-card-error',
        ...listBase,
        responses: { start_application: fail('Sign in to NP Hiring to apply.') },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Easy Apply', nth: 0 } }, { waitText: 'Sign in to NP Hiring to apply.' }],
    },
    {
        name: 'list-focus',
        ...listBase,
        waitFor: '[data-view="job-list"]',
        steps: [{ press: 'Tab', times: 3 }],
    },
    {
        name: 'list-fullscreen',
        ...listBase,
        host: { displayMode: 'fullscreen' },
        height: 1400,
        waitFor: '[data-view="job-list"]',
    },
    { name: 'detail', ...detailBase, waitFor: '[data-view="job-detail"]' },
    { name: 'detail-skeleton', ...detailBase, result: 'pending', waitFor: '[data-view="skeleton-job-detail"]' },
    {
        name: 'detail-expanded',
        ...detailBase,
        waitFor: '[data-view="job-detail"]',
        steps: [{ click: { role: 'button', name: 'Show more' } }],
    },
    {
        name: 'detail-saved',
        ...detailBase,
        responses: { save_job: ok({ jobId: 'job_abhp_outpatient', saved: true }) },
        waitFor: '[data-view="job-detail"]',
        steps: [{ click: { role: 'button', name: 'Save' } }, { waitText: 'Saved' }],
    },
    {
        name: 'detail-save-error',
        ...detailBase,
        responses: { save_job: fail('Sign in to NP Hiring to save jobs.') },
        waitFor: '[data-view="job-detail"]',
        steps: [{ click: { role: 'button', name: 'Save' } }, { waitText: 'Sign in to NP Hiring to save jobs.' }],
    },
    {
        name: 'detail-from-list',
        ...listBase,
        responses: { get_job: ok(jobDetailView()) },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Details', nth: 1 } }, { waitFor: '[data-view="job-detail"]' }],
    },
    {
        name: 'detail-loading-from-list',
        ...listBase,
        responses: { get_job: 'pending' },
        waitFor: '[data-view="job-list"]',
        steps: [{ click: { role: 'button', name: 'Details', nth: 1 } }, { waitFor: '[data-view="skeleton-job-detail"]' }],
    },
    { name: 'apply', ...applyBase, waitFor: '[data-view="apply"]' },
    { name: 'apply-skeleton', ...applyBase, result: 'pending', waitFor: '[data-view="skeleton-apply"]' },
    { name: 'apply-existing', ...applyBase, result: ok(applyViewExisting()), waitFor: '[data-view="apply"]' },
    { name: 'apply-ready', ...applyBase, waitFor: '[data-view="apply"]', steps: fillRequired },
    {
        name: 'apply-focus',
        ...applyBase,
        waitFor: '[data-view="apply"]',
        steps: [{ press: 'Tab', times: 2 }],
    },
    {
        name: 'apply-submitting',
        ...applyBase,
        responses: { submit_application: 'pending' },
        waitFor: '[data-view="apply"]',
        steps: [...fillRequired, { click: { role: 'button', name: 'Submit application' } }, { waitText: 'Submitting' }],
    },
    {
        name: 'apply-required-error',
        ...applyBase,
        responses: {
            submit_application: fail('Answer the required questions.', { missingQuestionIds: ['q_schedule'] }),
        },
        waitFor: '[data-view="apply"]',
        steps: [
            ...fillRequired,
            { click: { role: 'button', name: 'Submit application' } },
            { waitText: 'This question is required.' },
        ],
    },
    {
        name: 'apply-submit-error',
        ...applyBase,
        responses: { submit_application: fail('This job stopped taking applications before yours was sent.') },
        waitFor: '[data-view="apply"]',
        steps: [
            ...fillRequired,
            { click: { role: 'button', name: 'Submit application' } },
            { waitText: 'This job stopped taking applications' },
        ],
    },
    {
        name: 'apply-submitted',
        ...applyBase,
        responses: { submit_application: ok(applyResultView()) },
        waitFor: '[data-view="apply"]',
        steps: [...fillRequired, { click: { role: 'button', name: 'Submit application' } }, { waitFor: '[data-view="apply-result"]' }],
    },
    { name: 'apply-blocked', ...applyBase, result: ok(applyViewBlocked(true)), waitFor: '[data-view="apply"]' },
    {
        name: 'apply-blocked-tracked',
        ...applyBase,
        result: ok(applyViewBlocked(true)),
        responses: {
            track_employer_site_application: ok({
                applicationId: 'app_bswh',
                jobId: 'job_bswh_inpatient',
                alreadyTracked: false,
                employerApplyUrl: 'https://jobs.bswhealth.com/us/en/job/R-123456',
                myApplicationsUrl: 'https://nphiring.com/my-applications',
            }),
        },
        waitFor: '[data-view="apply"]',
        steps: [{ click: { role: 'button', name: 'Continue on employer site' } }, { waitText: 'Added to My applications' }],
    },
    { name: 'apply-closed', ...applyBase, result: ok(applyViewBlocked(false)), waitFor: '[data-view="apply"]' },
    {
        name: 'result',
        tool: 'submit_application',
        input: { job_id: 'job_abhp_outpatient', consent: true },
        result: ok(applyResultView()),
        waitFor: '[data-view="apply-result"]',
    },
    {
        name: 'result-skeleton',
        tool: 'submit_application',
        input: { job_id: 'job_abhp_outpatient', consent: true },
        result: 'pending',
        waitFor: '[data-view="skeleton-apply-result"]',
    },
    {
        name: 'result-resubmitted',
        tool: 'submit_application',
        input: { job_id: 'job_abhp_outpatient', consent: true },
        result: ok(applyResultView(true)),
        waitFor: '[data-view="apply-result"]',
    },
    {
        name: 'result-to-applications',
        tool: 'submit_application',
        input: { job_id: 'job_abhp_outpatient', consent: true },
        result: ok(applyResultView()),
        responses: { list_my_applications: ok(applicationsView()) },
        waitFor: '[data-view="apply-result"]',
        steps: [{ click: { role: 'button', name: 'My applications' } }, { waitFor: '[data-view="applications"]' }],
    },
    { name: 'applications', ...applicationsBase, waitFor: '[data-view="applications"]' },
    {
        name: 'applications-skeleton',
        ...applicationsBase,
        result: 'pending',
        waitFor: '[data-view="skeleton-applications"]',
    },
    {
        name: 'applications-confirm',
        ...applicationsBase,
        waitFor: '[data-view="applications"]',
        steps: [{ click: { role: 'button', name: 'Withdraw', nth: 0 } }, { waitText: 'Withdraw this application?' }],
    },
    {
        name: 'applications-withdrawn',
        ...applicationsBase,
        responses: {
            withdraw_application: ok({
                applicationId: 'app_talkiatry',
                status: 'withdrawn',
                jobTitle: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)',
                employer: 'Talkiatry',
            }),
        },
        waitFor: '[data-view="applications"]',
        steps: [
            { click: { role: 'button', name: 'Withdraw', nth: 0 } },
            { click: { role: 'button', name: 'Withdraw', nth: 0, within: '.confirm' } },
            { waitGone: '.confirm' },
        ],
    },
    {
        name: 'applications-empty',
        ...applicationsBase,
        result: ok(applicationsView({ applications: [], summary: [], total: 0 })),
        waitFor: '[data-view="applications"]',
    },
    {
        name: 'error',
        ...detailBase,
        result: fail('We could not find that job. It may have been filled or removed.'),
        waitFor: '[data-view="error"]',
    },
    { name: 'error-generic', ...detailBase, result: fail(''), waitFor: '[data-view="error"]' },
];

export function findScenario(name) {
    return SCENARIOS.find((scenario) => scenario.name === name) ?? SCENARIOS[0];
}

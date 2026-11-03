/**
 * Fixture tool results for the widget preview harness (not part of the app).
 * Shapes follow lib/mcp/contracts.ts; dates are relative to the moment the
 * harness loads so "Posted today" and friends stay true.
 */

const DAY = 86_400_000;

export function daysAgo(days, now = Date.now()) {
    return new Date(now - days * DAY).toISOString();
}

const SITE = 'https://nphiring.com';

function job(overrides) {
    return {
        id: 'job_0',
        title: 'Nurse Practitioner',
        employer: 'NP Hiring Employer',
        location: 'Austin, TX',
        workMode: 'On site',
        jobType: 'Full-Time',
        pay: null,
        payIsEstimate: false,
        experience: null,
        newGradFriendly: false,
        postedAt: daysAgo(2),
        easyApply: false,
        url: `${SITE}/jobs/nurse-practitioner-job_0`,
        sandbox: false,
        saved: false,
        applicationStatus: null,
        ...overrides,
    };
}

export function firstPageJobs() {
    return [
        job({
            id: 'job_talkiatry_pmhnp',
            title: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)',
            employer: 'Talkiatry',
            location: 'Remote (Texas)',
            workMode: 'Remote',
            jobType: 'Full-Time',
            pay: '$135k to $165k/yr',
            experience: '1+ year',
            postedAt: daysAgo(0),
            easyApply: true,
        }),
        job({
            id: 'job_abhp_outpatient',
            title: 'Outpatient PMHNP, Adult and Adolescent',
            employer: 'Austin Behavioral Health Partners',
            location: 'Austin, TX',
            workMode: 'Hybrid',
            jobType: 'Full-Time',
            pay: '$140k to $160k/yr',
            payIsEstimate: true,
            newGradFriendly: true,
            postedAt: daysAgo(1),
            easyApply: true,
            applicationStatus: 'interview',
        }),
        job({
            id: 'job_lifestance_tele',
            title: 'Telepsychiatry Nurse Practitioner',
            employer: 'LifeStance Health',
            location: 'Houston, TX',
            workMode: 'Remote',
            jobType: 'Part-Time',
            pay: '$70 to $85/hr',
            experience: '2+ years',
            postedAt: daysAgo(3),
        }),
        job({
            id: 'job_bswh_inpatient',
            title: 'Psychiatric Nurse Practitioner, Inpatient Behavioral Health Unit',
            employer: 'Baylor Scott & White Health',
            location: 'Dallas, TX',
            workMode: 'On site',
            jobType: 'Full-Time',
            pay: '$150k to $172k/yr',
            experience: '3+ years',
            postedAt: daysAgo(12),
            applicationStatus: 'applied',
        }),
        job({
            id: 'job_lscc_primary',
            title: 'Family Psychiatric NP, Integrated Primary Care',
            employer: 'Lone Star Circle of Care',
            location: 'Round Rock, TX',
            workMode: 'On site',
            jobType: 'Full-Time',
            newGradFriendly: true,
            postedAt: daysAgo(45),
            easyApply: true,
        }),
        job({
            id: 'job_acadia_sud',
            title: 'PMHNP, Substance Use Disorder Program',
            employer: 'Acadia Healthcare',
            location: 'San Antonio, TX',
            workMode: 'On site',
            jobType: 'Contract',
            pay: '$95/hr',
            payIsEstimate: true,
            postedAt: daysAgo(6),
            easyApply: true,
        }),
    ];
}

export function secondPageJobs() {
    return [
        job({
            id: 'job_ut_health_cl',
            title: 'Consultation Liaison Psychiatric NP',
            employer: 'UT Health San Antonio',
            location: 'San Antonio, TX',
            workMode: 'On site',
            jobType: 'Full-Time',
            pay: '$138k to $155k/yr',
            experience: '2+ years',
            postedAt: daysAgo(4),
            easyApply: true,
        }),
        job({
            id: 'job_cerebral_remote',
            title: 'Remote PMHNP, Evenings and Weekends',
            employer: 'Cerebral',
            location: 'Remote (Texas)',
            workMode: 'Remote',
            jobType: 'Per Diem',
            pay: '$80/hr',
            newGradFriendly: true,
            postedAt: daysAgo(8),
        }),
        job({
            id: 'job_mhmr_tarrant',
            title: 'Psychiatric NP, Community Mental Health',
            employer: 'MHMR of Tarrant County',
            location: 'Fort Worth, TX',
            workMode: 'Hybrid',
            jobType: 'Full-Time',
            pay: '$128k to $146k/yr',
            postedAt: daysAgo(15),
            easyApply: true,
        }),
    ];
}

export function jobListView(overrides = {}) {
    return {
        view: 'job-list',
        heading: 'Psychiatric NP jobs in Texas',
        filters: ['Psychiatric mental health', 'Texas', '$120k+/yr'],
        total: 128,
        page: 1,
        totalPages: 22,
        jobs: firstPageJobs(),
        nextPageArgs: { query: 'psychiatric', state: 'TX', min_salary: 120000, page: 2, limit: 6 },
        browseUrl: `${SITE}/jobs?q=psychiatric&state=TX&minSalary=120000`,
        signedIn: true,
        ...overrides,
    };
}

export function secondPageView() {
    return jobListView({
        page: 2,
        jobs: secondPageJobs(),
        nextPageArgs: null,
    });
}

const DESCRIPTION = [
    'Austin Behavioral Health Partners is a clinician-owned outpatient practice serving adults and adolescents across Central Texas. We are adding a PMHNP to our Westlake clinic as our adolescent program grows.',
    'What you will do',
    'Provide psychiatric evaluations and medication management for patients ages 12 and up, in person and by video.',
    'Work alongside two psychiatrists, four therapists and a dedicated care coordinator who handles prior authorizations.',
    'See a panel that ramps over 90 days, with 60 minute intakes and 30 minute follow ups.',
    'Join a weekly case conference and monthly peer review.',
    'What we offer',
    'A four day clinical week, protected administrative time and a full support staff.',
    'Supervision and mentorship for new graduates during a structured six month onboarding.',
    'CME allowance of $3,000 per year, paid licensure and DEA renewal, and malpractice with tail coverage.',
    'Requirements: active Texas APRN license with PMHNP board certification, or eligibility within 90 days of graduation.',
].join('\n');

export function jobDetailView(overrides = {}) {
    const base = firstPageJobs()[1];
    return {
        view: 'job-detail',
        job: {
            ...base,
            summary:
                'Outpatient psychiatric practice in Austin hiring a PMHNP for adult and adolescent medication management, with a four day clinical week and structured onboarding for new graduates.',
            description: DESCRIPTION,
            descriptionTruncated: false,
            setting: 'Outpatient clinic',
            population: 'Adults and adolescents',
            benefits: ['Health, dental and vision', '401(k) with 4% match', '$3,000 CME allowance', 'Malpractice with tail', 'Paid licensure'],
            experienceNote: 'Structured onboarding for new graduates',
            applyRoute: 'easy_apply',
            screeningQuestionCount: 5,
            updatedAt: daysAgo(1),
            ...overrides,
        },
        signedIn: true,
    };
}

const COVER_LETTER = [
    'Dear Hiring Team,',
    '',
    'I am a board-certified PMHNP with two years of outpatient experience in a group practice in Round Rock, where I manage a panel of about 450 adult and adolescent patients. Your adolescent program and the weekly case conference stood out to me, because collaborative care is how I do my best work.',
    '',
    'I hold an active Texas APRN license, see patients in person and by video, and am comfortable with long-acting injectables and pharmacogenomic testing. I would welcome the chance to talk about how I could support your Westlake clinic.',
    '',
    'Thank you for your time,',
    'Jane Doe, PMHNP-BC',
].join('\n');

export const APPLY_CONSENT_TEXT =
    'I consent to sharing my profile, resume, and cover letter with this employer. You may withdraw your application at any time.';

export function screeningQuestions() {
    return [
        {
            id: 'q_license',
            text: 'Do you hold an active, unencumbered APRN license in Texas?',
            type: 'boolean',
            options: [],
            required: true,
        },
        {
            id: 'q_schedule',
            text: 'Which schedule do you prefer?',
            type: 'select',
            options: ['Four 10-hour days', 'Five 8-hour days', 'Flexible'],
            required: true,
        },
        {
            id: 'q_years',
            text: 'How many years have you practiced as a PMHNP?',
            type: 'number',
            options: [],
            required: false,
        },
        {
            id: 'q_adolescent',
            text: 'Tell us about your experience with adolescent patients, including settings where you managed medication for patients under 18.',
            type: 'text',
            options: [],
            required: false,
        },
        {
            id: 'q_start',
            text: 'When could you start?',
            type: 'text',
            options: [],
            required: true,
        },
    ];
}

export function applyView(overrides = {}) {
    const base = firstPageJobs()[1];
    return {
        view: 'apply',
        job: { ...base, applicationStatus: null, applyRoute: 'easy_apply' },
        candidate: { firstName: 'Jane', headline: 'PMHNP-BC, outpatient psychiatry' },
        resume: { onFile: true, fileName: 'Jane-Doe-PMHNP-Resume.pdf' },
        questions: screeningQuestions(),
        coverLetterDraft: COVER_LETTER,
        coverLetterMax: 5000,
        consentText: APPLY_CONSENT_TEXT,
        privacyUrl: `${SITE}/privacy`,
        profileUrl: `${SITE}/dashboard/profile`,
        employerApplyUrl: null,
        existingApplication: null,
        canSubmit: true,
        blockedReason: null,
        ...overrides,
    };
}

export function applyViewExisting() {
    return applyView({
        resume: { onFile: false, fileName: null },
        questions: screeningQuestions().slice(0, 2),
        existingApplication: { id: 'app_abhp', status: 'screening', statusLabel: 'Screening', appliedAt: daysAgo(10) },
    });
}

export function applyViewBlocked(withUrl = true) {
    const base = firstPageJobs()[3];
    return applyView({
        job: { ...base, applicationStatus: null, applyRoute: withUrl ? 'employer_site' : 'none' },
        questions: [],
        coverLetterDraft: '',
        canSubmit: false,
        employerApplyUrl: withUrl ? 'https://jobs.bswhealth.com/us/en/job/R-123456' : null,
        blockedReason: withUrl
            ? 'Baylor Scott & White Health takes applications on its own careers site.'
            : 'This job is no longer taking applications.',
    });
}

export function applyResultView(resubmitted = false) {
    const base = firstPageJobs()[1];
    return {
        view: 'apply-result',
        applicationId: 'app_abhp',
        job: { ...base, applicationStatus: 'applied' },
        resubmitted,
        appliedAt: daysAgo(0),
        myApplicationsUrl: `${SITE}/my-applications`,
    };
}

function application(overrides) {
    return {
        id: 'app_0',
        jobId: 'job_0',
        title: 'Nurse Practitioner',
        employer: 'Employer',
        location: 'Austin, TX',
        appliedAt: daysAgo(3),
        status: 'applied',
        statusLabel: 'Applied',
        easyApply: true,
        jobUrl: `${SITE}/jobs/nurse-practitioner`,
        jobOpen: true,
        canWithdraw: true,
        ...overrides,
    };
}

export function applicationsView(overrides = {}) {
    const applications = [
        application({
            id: 'app_talkiatry',
            jobId: 'job_talkiatry_pmhnp',
            title: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)',
            employer: 'Talkiatry',
            location: 'Remote (Texas)',
            appliedAt: daysAgo(0),
        }),
        application({
            id: 'app_abhp',
            jobId: 'job_abhp_outpatient',
            title: 'Outpatient PMHNP, Adult and Adolescent',
            employer: 'Austin Behavioral Health Partners',
            appliedAt: daysAgo(9),
            status: 'interview',
            statusLabel: 'Interview',
        }),
        application({
            id: 'app_bswh',
            jobId: 'job_bswh_inpatient',
            title: 'Psychiatric Nurse Practitioner, Inpatient Behavioral Health Unit',
            employer: 'Baylor Scott & White Health',
            location: 'Dallas, TX',
            appliedAt: daysAgo(12),
            easyApply: false,
            status: 'screening',
            statusLabel: 'Screening',
        }),
        application({
            id: 'app_ut',
            jobId: 'job_ut_health_cl',
            title: 'Consultation Liaison Psychiatric NP',
            employer: 'UT Health San Antonio',
            location: 'San Antonio, TX',
            appliedAt: daysAgo(30),
            status: 'offered',
            statusLabel: 'Offered',
            canWithdraw: true,
        }),
        application({
            id: 'app_cerebral',
            jobId: 'job_cerebral_remote',
            title: 'Remote PMHNP, Evenings and Weekends',
            employer: 'Cerebral',
            appliedAt: daysAgo(41),
            easyApply: false,
            status: 'rejected',
            statusLabel: 'Not Selected',
            canWithdraw: false,
        }),
        application({
            id: 'app_mhmr',
            jobId: 'job_mhmr_tarrant',
            title: 'Psychiatric NP, Community Mental Health',
            employer: 'MHMR of Tarrant County',
            location: 'Fort Worth, TX',
            appliedAt: daysAgo(60),
            status: 'withdrawn',
            statusLabel: 'Withdrawn',
            canWithdraw: false,
        }),
    ];
    return {
        view: 'applications',
        applications,
        summary: [
            { status: 'applied', label: 'Applied', count: 1 },
            { status: 'screening', label: 'Screening', count: 1 },
            { status: 'interview', label: 'Interview', count: 1 },
            { status: 'offered', label: 'Offered', count: 1 },
            { status: 'rejected', label: 'Not Selected', count: 1 },
            { status: 'withdrawn', label: 'Withdrawn', count: 1 },
        ],
        total: 6,
        myApplicationsUrl: `${SITE}/my-applications`,
        ...overrides,
    };
}

/** A tool result carrying a view, the way the MCP server answers. */
export function ok(structuredContent, text = 'Done.') {
    return { content: [{ type: 'text', text }], structuredContent };
}

export function fail(text, structuredContent) {
    return {
        isError: true,
        content: text ? [{ type: 'text', text }] : [],
        ...(structuredContent ? { structuredContent } : {}),
    };
}

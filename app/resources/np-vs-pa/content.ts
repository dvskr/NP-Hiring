/**
 * Copy and data for /resources/np-vs-pa.
 *
 * Same structure as the what-is-a-nurse-practitioner guide, rendered by the
 * same view (app/resources/what-is-a-nurse-practitioner/guide-view.tsx), so
 * the two definition guides share one layout, one JSON-LD builder and one
 * figures registry.
 *
 * FIGURES. NP pay, NP growth and the full practice count come from
 * lib/stats-sources.ts. PA pay is from the same BLS OEWS release as the NP
 * median, and every NP and PA employment figure is from the same BLS
 * Employment Projections table and cycle as the NP growth rate
 * (verified-facts.ts), so each row compares like for like.
 */
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    monthYear,
    type FaqItem,
    type GuideContent,
    type GuideSection,
    type SourceLink,
    type VerifiedFigure,
} from '@/app/resources/what-is-a-nurse-practitioner/guide-model';
import { BLS_PROJECTIONS, PA_MEDIAN_WAGE, PRIMARY_SOURCES } from '@/app/resources/what-is-a-nurse-practitioner/verified-facts';

export const NP_VS_PA_PATH = '/resources/np-vs-pa';

/** First publication and last review: Article.datePublished and dateModified. */
export const PAGE_DATE = '2026-11-23';

const NP = brand.niche.short;
const NP_TITLE = brand.niche.long;
const NP_PROSE = brand.niche.descriptor;
/** 'Nurse practitioner': the descriptor at the start of a sentence or a label. */
const NP_SENTENCE = NP_PROSE.charAt(0).toUpperCase() + NP_PROSE.slice(1);

const NP_MEDIAN = STAT_SOURCES.npMedianWageBls.formatted;
const PAY_VINTAGE = monthYear(STAT_SOURCES.npMedianWageBls.asOf);
const NP_GROWTH = STAT_SOURCES.blsGrowth2035.formatted;
const FULL_PRACTICE = STAT_SOURCES.fullPracticeStates;
const PA_MEDIAN = PA_MEDIAN_WAGE.formatted;
/** The two medians' gap and which role leads, computed so the copy follows the figures. */
const PAY_GAP = Number(PA_MEDIAN_WAGE.value) - Number(STAT_SOURCES.npMedianWageBls.value);
const MEDIAN_GAP = `$${Math.abs(PAY_GAP).toLocaleString('en-US')}`;
const HIGHER_PAID = PAY_GAP >= 0 ? 'PAs' : `${NP}s`;
const NP_JOBS = BLS_PROJECTIONS.nursePractitioners;
const PA_JOBS = BLS_PROJECTIONS.physicianAssistants;
const CYCLE = BLS_PROJECTIONS.cycle;

const QUICK_ANSWER =
    `${NP_SENTENCE}s (${NP}s) and physician assistants (PAs) both diagnose, treat and prescribe. ${NP}s are registered ` +
    `nurses with graduate nursing education in a population focus; PAs usually complete a master's PA program and pass ` +
    `the PANCE. In most states PAs practice under a physician agreement, while AANP classifies ${FULL_PRACTICE.formatted} ` +
    `as Full Practice for ${NP}s.`;

// ─── Sections ────────────────────────────────────────────────────────────────

const OVERVIEW: GuideSection = {
    id: 'differences',
    heading: `How Are ${NP}s and PAs Different?`,
    icon: 'scale',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                'Both roles examine patients, diagnose illness, order tests, provide treatment and prescribe medication, and ' +
                    'both work in primary care, hospitals and specialty practices. The differences are in how each one trains, ' +
                    'who certifies it and how state law lets it practice.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `${NP} education builds on nursing. An ${NP} is first a registered nurse, then completes a graduate ${NP} program ` +
                    'in a population focus. PA education follows a medical curriculum: BLS lists classroom and laboratory ' +
                    'instruction in subjects such as human anatomy, clinical medicine and pharmacology, plus supervised clinical ' +
                    'training in several specialties.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `New to the ${NP} role? Start with `,
                { text: `what a ${NP_PROSE} is`, href: '/resources/what-is-a-nurse-practitioner' },
                '.',
            ],
        },
    ],
};

const SIDE_BY_SIDE: GuideSection = {
    id: 'comparison',
    heading: `${NP} vs PA Side by Side`,
    icon: 'listChecks',
    blocks: [
        {
            kind: 'table',
            caption:
                'Nurse practitioner and physician assistant compared by education model, degree, clinical hours, certification, ' +
                'recertification, practice authority, specialty flexibility, pay and outlook',
            columns: ['Compared', `${NP_SENTENCE} (${NP})`, 'Physician assistant (PA)'],
            rows: [
                {
                    label: 'Education model',
                    cells: [
                        [
                            'Nursing. NP programs build on a registered nurse license and include graduate courses in advanced ' +
                                'physiology and pathophysiology, health assessment and pharmacology.',
                        ],
                        [
                            'Medicine. PA programs teach subjects such as human anatomy, clinical medicine and pharmacology, and ' +
                                "applicants typically have a bachelor's degree and experience caring directly for patients.",
                        ],
                    ],
                },
                {
                    label: 'Degree and program length',
                    cells: [
                        [
                            "An MSN, post-graduate certificate or DNP from an accredited program; BLS says NPs typically need at least a master's " +
                                'degree. Each school sets its own program length.',
                        ],
                        [
                            "A master's degree from an accredited program; BLS says PA programs usually take at least 2 years of " +
                                'postbaccalaureate study.',
                        ],
                    ],
                },
                {
                    label: 'Clinical hours',
                    cells: [
                        ['At least 500 faculty-supervised clinical hours to sit either family NP certification exam, from ANCC or AANPCB.'],
                        [
                            'Supervised clinical training in several specialties, such as family medicine, internal medicine and ' +
                                'emergency medicine. The BLS and NCCPA pages cited here set no national hour minimum, so ask each ' +
                                'program for its total.',
                        ],
                    ],
                },
                {
                    label: 'Certifying body and exam',
                    cells: [
                        [
                            "AANPCB (operating as NPCB) or ANCC, with an exam in the NP's population focus. A family NP " +
                                'certifies as NP-C through AANPCB or as FNP-BC through ANCC.',
                        ],
                        [
                            'NCCPA, through the Physician Assistant National Certifying Examination (PANCE), which is open to ' +
                                'graduates of programs accredited by ARC-PA. Passing earns the PA-C credential.',
                        ],
                    ],
                },
                {
                    label: 'Recertification',
                    cells: [
                        [
                            'Every 5 years. AANPCB renews with 100 contact hours of continuing education (at least 25 in ' +
                                'pharmacology) and 1,000 practice hours in the certification period, or by retaking the exam; ANCC renews ' +
                                'every 5 years under its renewal handbook.',
                        ],
                        [
                            'A 10-year cycle made of five two-year periods: 100 CME credits in each period, and a recertification ' +
                                'exam, PANRE or PANRE-LA, passed by the end of year 10.',
                        ],
                    ],
                },
                {
                    label: 'Practice authority',
                    cells: [
                        [
                            `Set by state law. AANP classifies ${FULL_PRACTICE.formatted} as Full Practice; elsewhere state law ` +
                                `reduces or restricts at least one element of ${NP} practice, for example through a collaborative ` +
                                'agreement or supervision.',
                        ],
                        [
                            'Set by state law. BLS says that in most states PAs must hold an agreement with a supervising ' +
                                'physician, and that collaboration between physicians and PAs is required for practice.',
                        ],
                    ],
                },
                {
                    label: 'Specialty flexibility',
                    cells: [
                        [
                            'Education, certification and licensure must match one population focus, so moving to another focus ' +
                                'means more graduate education and another certification exam.',
                        ],
                        [
                            'One national credential, PA-C, earned through one exam. BLS notes PAs work in a variety of ' +
                                'specialties and that their work depends largely on the specialty or type of practice.',
                        ],
                    ],
                },
                {
                    label: `Median pay, ${PAY_VINTAGE}`,
                    cells: [[NP_MEDIAN], [PA_MEDIAN]],
                },
                {
                    label: `Jobs in ${CYCLE.from}`,
                    cells: [[NP_JOBS.jobsBase], [PA_JOBS.jobsBase]],
                },
                {
                    label: `Projected growth, ${CYCLE.from} to ${CYCLE.to}`,
                    cells: [[NP_GROWTH], [PA_JOBS.growth]],
                },
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `Pay figures are BLS medians for ${PAY_VINTAGE}, and employment and growth are BLS projections for ${CYCLE.from} ` +
                    `to ${CYCLE.to}. Practice and certification rules change, so confirm them with the certifying body and the ` +
                    'state licensing board.',
            ],
        },
    ],
};

const PAY: GuideSection = {
    id: 'pay',
    heading: `Do ${NP}s or PAs Make More?`,
    icon: 'wallet',
    blocks: [
        {
            kind: 'stats',
            items: [
                { value: PA_MEDIAN, label: 'Physician assistant median annual wage' },
                { value: NP_MEDIAN, label: `${NP_SENTENCE} median annual wage` },
            ],
            caption: [`BLS Occupational Employment and Wage Statistics, ${PAY_VINTAGE}.`],
        },
        {
            kind: 'paragraph',
            content: [
                `BLS reports a median annual wage of ${PA_MEDIAN} for physician assistants and ${NP_MEDIAN} for nurse ` +
                    `practitioners, a gap of ${MEDIAN_GAP}, both from its ${PAY_VINTAGE} Occupational Employment and Wage ` +
                    'Statistics survey. Each median covers every specialty, setting and experience level, so compare offers for the same ' +
                    'specialty and region rather than the national medians.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `For ${NP} pay by state, setting and specialty, see the `,
                { text: `${NP} salary guide`, href: '/salary-guide' },
                '.',
            ],
        },
    ],
};

const OUTLOOK: GuideSection = {
    id: 'outlook',
    heading: `Job Outlook for ${NP}s and PAs`,
    icon: 'trending',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `BLS projects nurse practitioner employment to grow ${NP_GROWTH} from ${CYCLE.from} to ${CYCLE.to}, from ` +
                    `${NP_JOBS.jobsBase} jobs to ${NP_JOBS.jobsProjected}, and physician assistant employment to grow ` +
                    `${PA_JOBS.growth}, from ${PA_JOBS.jobsBase} jobs to ${PA_JOBS.jobsProjected}. Both occupations appear in the ` +
                    'BLS table of the fastest growing occupations for that period.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'These are national projections, not forecasts for a town or a specialty. Browse current ',
                { text: `${NP} jobs`, href: '/jobs' },
                ' to see who is hiring near you.',
            ],
        },
    ],
};

const CHOOSE: GuideSection = {
    id: 'which-to-choose',
    heading: `${NP} or PA: Which Should You Choose?`,
    icon: 'compass',
    blocks: [
        {
            kind: 'choices',
            columns: [
                {
                    heading: `The ${NP} path may fit if you`,
                    items: [
                        ['Are a registered nurse, or want to work as one before advanced practice'],
                        ['Know the patients you want to serve, such as families, children or older adults'],
                        [
                            `Want the option of full practice authority, which AANP reports in ${FULL_PRACTICE.formatted}, ` +
                                'although some of those states first require a transition period',
                        ],
                    ],
                },
                {
                    heading: 'The PA path may fit if you',
                    items: [
                        ['Want a medical curriculum without first becoming a registered nurse'],
                        ['Want one national credential, PA-C, that is not tied to a single patient population'],
                        ['Are comfortable practicing on a team with a supervising or collaborating physician, as most states require'],
                    ],
                },
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `Neither path is better in general. The national medians are ${MEDIAN_GAP} apart, both occupations are projected ` +
                    'to grow much faster than average, and in a clinic both can examine, diagnose, treat and prescribe. The deciding ' +
                    'questions are where you start, which patients you want to treat and how much practice independence matters to you.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `Before you decide, read your state's ${NP} practice rule in the `,
                { text: 'scope of practice explorer', href: '/scope-of-practice' },
                ', and confirm it with the state board that would license you.',
            ],
        },
    ],
};

// ─── FAQ ─────────────────────────────────────────────────────────────────────

/** One array for the visible FAQ and the FAQPage markup, so the two cannot drift. */
const FAQS: readonly FaqItem[] = [
    {
        question: `What is the difference between an ${NP} and a PA?`,
        answer: [
            `${NP}s are registered nurses who complete graduate nursing education in a population focus and certify through ` +
                'AANPCB or ANCC. PAs complete a PA program, typically a master\'s degree, and certify through NCCPA by passing the ' +
                'PANCE. Both diagnose, treat and prescribe, and state law sets how much physician involvement each one needs.',
        ],
    },
    {
        question: `Which is better, ${NP} or PA?`,
        answer: [
            `Neither is better in general. The ${NP} path builds on nursing and ties your training to a population focus, and ` +
                `AANP classifies ${FULL_PRACTICE.formatted} as Full Practice for ${NP}s. The PA path follows a medical curriculum ` +
                'with one credential across specialties, and in most states PAs practice under an agreement with a supervising ' +
                'physician. Choose by where you start and how you want to practice.',
        ],
    },
    {
        question: `Do ${NP}s or PAs make more money?`,
        answer: [
            `${HIGHER_PAID} have the higher national median, by ${MEDIAN_GAP}. BLS reports a median annual wage of ` +
                `${PA_MEDIAN} for physician assistants and ${NP_MEDIAN} for nurse practitioners in ${PAY_VINTAGE}, from the ` +
                'same survey. Medians cover every specialty and setting, so compare offers for the same specialty and region.',
        ],
    },
    {
        question: `Can ${NP}s and PAs practice independently?`,
        answer: [
            `It depends on the state. AANP classifies ${FULL_PRACTICE.formatted} as Full Practice for ${NP}s, although some of ` +
                'those states first require a transition period. For PAs, BLS reports that most states require an agreement with ' +
                `a supervising physician. Rules change as legislatures act: check the ${NP} rule in the `,
            { text: 'scope of practice explorer', href: '/scope-of-practice' },
            ', and confirm any rule with the licensing board in your state.',
        ],
    },
    {
        question: `Do ${NP}s and PAs take the same certification exam?`,
        answer: [
            `No. ${NP}s sit a national exam in their population focus from a board such as AANPCB or ANCC; a family ${NP}, for ` +
                'example, earns NP-C from AANPCB or FNP-BC from ANCC. PAs sit the PANCE from NCCPA, which requires graduation from ' +
                'a program accredited by ARC-PA, and earn the PA-C credential.',
        ],
    },
    {
        question: `How often do ${NP}s and PAs recertify?`,
        answer: [
            `${NP} certification runs in 5-year periods: AANPCB renews by practice hours and continuing education or by ` +
                'retaking the exam, and ANCC renews every 5 years under its renewal handbook. PAs follow the NCCPA 10-year cycle: ' +
                '100 CME credits every two years and a recertification exam, PANRE or PANRE-LA, by the end of year 10.',
        ],
    },
    {
        question: `Can ${NP}s and PAs change specialties?`,
        answer: [
            'PAs hold one national credential, PA-C, and BLS notes they work in a variety of specialties. NPs are educated, ' +
                'certified and licensed in a population focus, so an NP who wants a different focus, for example moving from ' +
                'adult-gerontology to pediatrics, needs graduate education in that focus and its certification exam. Within a ' +
                'focus, NPs can work in specialties such as dermatology or cardiology.',
        ],
    },
];

// ─── Sources and figures ─────────────────────────────────────────────────────

const SOURCES: readonly SourceLink[] = [
    {
        label: STAT_SOURCES.blsGrowth2035.source,
        url: STAT_SOURCES.blsGrowth2035.sourceUrl,
        note: 'NP and PA employment at the start and end of the projection period, projected growth, and the median wage for both occupations',
    },
    { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl, note: 'the NP median wage' },
    { ...PRIMARY_SOURCES.blsPaWageSeries, note: `the PA median wage for ${PAY_VINTAGE}, from the same survey as the NP median` },
    { ...PRIMARY_SOURCES.blsOohPa, note: 'PA education, program length, clinical training, licensing, supervision agreements and specialties' },
    { ...PRIMARY_SOURCES.blsOohNp, note: 'NP duties, education and licensure' },
    { ...PRIMARY_SOURCES.nccpaCertify, note: 'the PANCE, its ARC-PA eligibility rule and the PA-C credential' },
    { ...PRIMARY_SOURCES.nccpaMaintain, note: 'the PA certification maintenance cycle, CME credits and the PANRE and PANRE-LA exams' },
    { ...PRIMARY_SOURCES.anccFnp, note: 'FNP-BC eligibility and clinical hours' },
    { ...PRIMARY_SOURCES.anccRenewals, note: 'the ANCC renewal cycle' },
    { ...PRIMARY_SOURCES.aanpcb, note: 'the nurse practitioner exams AANPCB offers' },
    { ...PRIMARY_SOURCES.aanpcbFnpHandbook, note: 'FNP eligibility, clinical hours and the NP-C credential' },
    { ...PRIMARY_SOURCES.aanpcbFaq, note: 'AANPCB renewal by practice hours and continuing education, or by exam' },
    { ...PRIMARY_SOURCES.consensusModel, note: 'the rule that NP education, certification and licensure match one population focus' },
    { label: FULL_PRACTICE.source, url: FULL_PRACTICE.sourceUrl, note: `practice environment classifications, ${FULL_PRACTICE.asOf}` },
];

/** Every figure the copy prints that is not read from lib/stats-sources.ts. */
const FIGURES: readonly VerifiedFigure[] = [
    { text: PA_MEDIAN, claim: `PA national median annual wage, ${PAY_VINTAGE}`, sourceUrl: PA_MEDIAN_WAGE.sourceUrl },
    { text: PA_MEDIAN, claim: 'PA median annual wage in the projections table', sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: NP_JOBS.jobsBase, claim: `NP employment in ${CYCLE.from}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: NP_JOBS.jobsProjected, claim: `projected NP employment in ${CYCLE.to}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: PA_JOBS.jobsBase, claim: `PA employment in ${CYCLE.from}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: PA_JOBS.jobsProjected, claim: `projected PA employment in ${CYCLE.to}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: PA_JOBS.growth, claim: 'projected PA employment growth', sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: MEDIAN_GAP, claim: 'gap between the PA and NP medians, computed from the two BLS figures', sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: '2', claim: 'minimum years of postbaccalaureate study in a PA program', sourceUrl: PRIMARY_SOURCES.blsOohPa.url },
    { text: '500', claim: 'minimum faculty-supervised clinical hours for the ANCC family exam', sourceUrl: PRIMARY_SOURCES.anccFnp.url },
    { text: '500', claim: 'minimum faculty-supervised direct patient care hours for the AANPCB family exam', sourceUrl: PRIMARY_SOURCES.aanpcbFnpHandbook.url },
    { text: '5', claim: 'years an AANPCB certification period lasts', sourceUrl: PRIMARY_SOURCES.aanpcbFnpHandbook.url },
    { text: '5', claim: 'years between ANCC renewals', sourceUrl: PRIMARY_SOURCES.anccRenewals.url },
    { text: '100', claim: 'continuing education contact hours for AANPCB renewal', sourceUrl: PRIMARY_SOURCES.aanpcbFaq.url },
    { text: '25', claim: 'pharmacology contact hours among them', sourceUrl: PRIMARY_SOURCES.aanpcbFaq.url },
    { text: '1,000', claim: 'practice hours for AANPCB renewal in the certification period', sourceUrl: PRIMARY_SOURCES.aanpcbFaq.url },
    { text: 'three', claim: 'practice environments AANP uses', sourceUrl: FULL_PRACTICE.sourceUrl },
    { text: '10', claim: 'years in the NCCPA certification maintenance cycle', sourceUrl: PRIMARY_SOURCES.nccpaMaintain.url },
    { text: 'five', claim: 'two-year periods in the NCCPA cycle', sourceUrl: PRIMARY_SOURCES.nccpaMaintain.url },
    { text: 'two', claim: 'years in each NCCPA CME period', sourceUrl: PRIMARY_SOURCES.nccpaMaintain.url },
    { text: '100', claim: 'CME credits in each NCCPA two-year period', sourceUrl: PRIMARY_SOURCES.nccpaMaintain.url },
];

export const NP_VS_PA: GuideContent = {
    path: NP_VS_PA_PATH,
    datePublished: PAGE_DATE,
    dateModified: PAGE_DATE,
    title: `${NP} vs PA: Education, Pay and Practice Compared`,
    description:
        `${NP_SENTENCE} vs physician assistant: how ${NP} and PA education, clinical hours, certification, practice authority, ` +
        'pay and job outlook compare.',
    keywords: [
        'np vs pa',
        'nurse practitioner vs physician assistant',
        'pa vs np',
        'np or pa which is better',
        'np vs pa salary',
        'np vs pa education',
    ],
    h1: `${NP} vs PA: ${NP_TITLE} vs Physician Assistant`,
    crumb: `${NP} vs PA`,
    ogTitle: `${NP} vs PA: ${NP_TITLE} vs Physician Assistant`,
    quickAnswer: QUICK_ANSWER,
    heroTone: 'pinkBlue',
    heroIcon: 'scale',
    sections: [OVERVIEW, SIDE_BY_SIDE, PAY, OUTLOOK, CHOOSE],
    faqHeading: 'Frequently Asked Questions',
    faqs: FAQS,
    sources: SOURCES,
    sourcesNote:
        `${brand.name} checked every figure on this page against these sources on the review date above. Practice, ` +
        'certification and licensure rules change, so confirm them with the certifying body and the state licensing board ' +
        'before you act on them.',
    figures: FIGURES,
    related: [
        {
            href: '/resources/what-is-a-nurse-practitioner',
            title: `What is a ${NP_PROSE}?`,
            description: 'The NP role, the path to practice, certification boards, specialties and pay.',
        },
        {
            href: '/scope-of-practice',
            title: 'Scope of practice by state',
            description: "Each state's practice authority rule for NPs, with board of nursing links.",
        },
        {
            href: '/resources/fpa-guide',
            title: 'Full Practice Authority guide',
            description: 'What full practice authority means, and how the three AANP classifications differ.',
        },
        {
            href: '/blog/how-to-become-a-nurse-practitioner',
            title: 'How to become a nurse practitioner',
            description: 'The steps from an RN license to certification and a state APRN license.',
        },
    ],
    cta: {
        heading: `Find ${NP} Jobs`,
        primary: { text: `Browse ${NP} Jobs`, href: '/jobs' },
        secondary: { text: 'View Salary Guide', href: '/salary-guide' },
    },
};

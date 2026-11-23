/**
 * Copy and data for /resources/what-is-a-nurse-practitioner.
 *
 * Kept apart from page.tsx so the tests, and app/sitemap.ts if it ever needs
 * PAGE_DATE, can import the page's data without importing a route module.
 * guide-view.tsx renders it; guide-model.ts builds the metadata and the
 * Article, FAQPage and BreadcrumbList JSON-LD from the same objects.
 *
 * FIGURES. NP pay, NP growth and the full practice count are read from
 * lib/stats-sources.ts and never typed here. Every other figure is listed in
 * FIGURES with the primary source it was checked against (see
 * verified-facts.ts), and every one of those sources is in SOURCES, which the
 * page prints.
 *
 * TRACK NAMES. The behavioral health track's name, abbreviation and jobs
 * hub derive from PSYCH_SPECIALTY_SLUG in lib/pseo/taxonomy-registry.ts, the
 * registry that owns that slug, so this file adds no reference-niche copy
 * (tests/regressions/niche-copy-debt.test.ts).
 */
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import { getAanpTierDefinition } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { monthYear, type FaqItem, type GuideContent, type GuideSection, type SourceLink, type VerifiedFigure } from './guide-model';
import { BLS_PROJECTIONS, PRIMARY_SOURCES } from './verified-facts';

export const WHAT_IS_A_NURSE_PRACTITIONER_PATH = '/resources/what-is-a-nurse-practitioner';

/** First publication and last review: Article.datePublished and dateModified. */
export const PAGE_DATE = '2026-11-23';

const NP = brand.niche.short;
const NP_TITLE = brand.niche.long;
const NP_PROSE = brand.niche.descriptor;
/** 'Nurse practitioner': the descriptor at the start of a sentence or a label. */
const NP_SENTENCE = NP_PROSE.charAt(0).toUpperCase() + NP_PROSE.slice(1);

const NP_MEDIAN = STAT_SOURCES.averageSalary.formatted;
const NP_P10 = STAT_SOURCES.salaryPercentile10.formatted;
const NP_P90 = STAT_SOURCES.salaryPercentile90.formatted;
const PAY_VINTAGE = monthYear(STAT_SOURCES.averageSalary.asOf);
const NP_GROWTH = STAT_SOURCES.blsGrowth2035.formatted;
const FULL_PRACTICE = STAT_SOURCES.fullPracticeStates;
const NP_JOBS = BLS_PROJECTIONS.nursePractitioners;
const CYCLE = BLS_PROJECTIONS.cycle;

// ─── The behavioral health track, from the registry ──────────────────────────

if (!PSYCH_SPECIALTY_SLUG) {
    throw new Error('lib/pseo/taxonomy-registry.ts no longer names a behavioral health specialty slug.');
}

/** The jobs hub slug, spelled as words: 'family-practice' gives 'Family Practice'. */
function slugWords(slug: string): string {
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

const BEHAVIORAL_SLUG = PSYCH_SPECIALTY_SLUG;
const BEHAVIORAL_NAME = slugWords(BEHAVIORAL_SLUG);
const BEHAVIORAL_PROSE = BEHAVIORAL_NAME.toLowerCase();
/** Initials of the track name plus the role: the credential stem the certifying boards use. */
const BEHAVIORAL_ABBREVIATION = `${BEHAVIORAL_NAME.split(' ').map((word) => word.charAt(0)).join('')}${NP}`;

// ─── Head ────────────────────────────────────────────────────────────────────

const QUICK_ANSWER =
    `A ${NP_PROSE} (${NP}) is a registered nurse with graduate education, national certification and a state license ` +
    `as an advanced practice registered nurse (APRN). ${NP}s assess patients, diagnose and treat illness, order tests ` +
    `and prescribe medication. Each ${NP} is educated and certified in at least one population focus, and state law ` +
    `sets what an ${NP} may do.`;

// ─── Sections ────────────────────────────────────────────────────────────────

const MEANING: GuideSection = {
    id: 'meaning',
    heading: `What Does ${NP} Stand For?`,
    icon: 'book',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `In medical terms, ${NP} stands for ${NP_PROSE}. The Consensus Model for APRN Regulation, the 2008 framework ` +
                    'completed by the APRN Consensus Work Group and the National Council of State Boards of Nursing (NCSBN) APRN ' +
                    'Advisory Committee, calls the role certified nurse practitioner (CNP). It is one of four advanced practice ' +
                    'registered nurse (APRN) roles, alongside the certified registered nurse anesthetist, the certified ' +
                    'nurse-midwife and the clinical nurse specialist.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Every nurse practitioner is therefore an APRN, but not every APRN is a nurse practitioner. Our guide to ',
                { text: 'what an APRN is', href: '/blog/what-is-an-aprn' },
                ' explains the other roles.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `On a badge, a resume or a job posting, ${NP} often appears beside the license title and a national certification. ` +
                    'In "APRN, FNP-BC", for example, APRN is the license title and FNP-BC is the family nurse practitioner ' +
                    'credential awarded by the American Nurses Credentialing Center (ANCC).',
            ],
        },
    ],
};

const ROLE: GuideSection = {
    id: 'role',
    heading: `What Does a ${NP_TITLE} Do?`,
    icon: 'stethoscope',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                'The Bureau of Labor Statistics (BLS) describes nurse practitioners as primary and specialty care providers, ' +
                    'and the Consensus Model describes them giving primary and acute care across settings. On a typical day the ' +
                    'work includes:',
            ],
        },
        {
            kind: 'checklist',
            items: [
                ['Taking patient histories and performing physical exams'],
                ['Ordering and interpreting laboratory and imaging studies'],
                ['Diagnosing acute and chronic illnesses and managing treatment plans'],
                ['Prescribing medication and other treatments, within the limits of state law'],
                ['Counseling patients and families on staying healthy and managing illness'],
                ['Consulting with physicians and other clinicians, and referring patients when needed'],
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Nurse practitioners typically care for a certain population of patients, such as families, adults and older ' +
                    'adults, or children, and that population focus shapes the day. BLS notes that although the scope of their ' +
                    'duties varies by state, many nurse practitioners work independently, prescribe medications and order ' +
                    `laboratory tests. Which of those an ${NP} may do alone, and under what agreement, is set by each state, so ` +
                    'confirm the rule with the state board of nursing.',
            ],
        },
    ],
};

const COMPARISON: GuideSection = {
    id: 'np-vs-physician-vs-pa',
    heading: `${NP_TITLE} vs Physician vs Physician Assistant`,
    icon: 'scale',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                'All three examine and diagnose patients, order tests and prescribe medication. They differ in how they train ' +
                    'and in the license each one holds.',
            ],
        },
        {
            kind: 'table',
            caption: 'Nurse practitioner, physician and physician assistant compared by education, entry-level degree and license',
            columns: ['Compared', `${NP_SENTENCE} (${NP})`, 'Physician (MD or DO)', 'Physician assistant (PA)'],
            rows: [
                {
                    label: 'Education',
                    cells: [
                        [`A registered nurse license, then a graduate ${NP} program: an MSN, a post-graduate certificate or a DNP`],
                        ["A bachelor's degree, 4 years of medical school, then 3 to 9 years of internship and residency, depending on the specialty"],
                        ["Usually a bachelor's degree and patient care experience, then a master's degree from an accredited PA program"],
                    ],
                },
                {
                    label: 'Typical entry-level degree (BLS)',
                    cells: [["Master's degree"], ['Doctoral or professional degree'], ["Master's degree"]],
                },
                {
                    label: 'Credential and license',
                    cells: [
                        ['National certification in a population focus, then a state APRN license'],
                        ['A state medical license; requirements vary by state'],
                        ['A state license after passing a qualifying exam, with the PA-C credential'],
                    ],
                },
            ],
        },
        {
            kind: 'paragraph',
            content: [
                `For a side by side look at ${NP} and PA education, clinical hours, certification, practice authority and pay, see `,
                { text: `${NP} vs PA`, href: '/resources/np-vs-pa' },
                '.',
            ],
        },
    ],
};

const BECOME: GuideSection = {
    id: 'become',
    heading: `How Do You Become a ${NP_TITLE}?`,
    icon: 'graduation',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `The usual path runs through a nursing license, a graduate ${NP} program, national certification and a state ` +
                    'APRN license. Our guide on ',
                { text: 'how to become a nurse practitioner', href: '/blog/how-to-become-a-nurse-practitioner' },
                ' covers programs, clinical placements and paying for school.',
            ],
        },
        {
            kind: 'steps',
            items: [
                {
                    title: 'Become a registered nurse',
                    detail: [
                        'Earn a nursing degree from an approved program, such as a Bachelor of Science in Nursing (BSN), and pass ' +
                            'the qualifying exam for a state RN license. BLS lists three education paths to RN practice: a ' +
                            "bachelor's degree, an associate degree or a diploma, and RNs without a bachelor's degree can complete an " +
                            'RN-to-BSN program.',
                    ],
                },
                {
                    title: `Complete an accredited graduate ${NP} program`,
                    detail: [
                        "Choose a population focus, then finish a master's (MSN), post-graduate certificate or Doctor of Nursing " +
                            'Practice (DNP) program. It includes graduate courses in advanced physiology and pathophysiology, advanced ' +
                            'health assessment and advanced pharmacology, and both family NP certification exams require at least 500 ' +
                            'faculty-supervised clinical hours.',
                    ],
                },
                {
                    title: 'Pass a national certification exam',
                    detail: [
                        'Sit the exam for your population focus. Family NPs can certify through AANPCB or ANCC, as the ',
                        { text: 'certification section', href: '#certification' },
                        ' below explains.',
                    ],
                },
                {
                    title: 'Get a state APRN license',
                    detail: [
                        'Apply to the board of nursing in the state where you will practice. BLS notes that most states require ' +
                            'national certification to become licensed and use an APRN title.',
                    ],
                },
            ],
        },
    ],
};

const CERTIFICATION: GuideSection = {
    id: 'certification',
    heading: `Which Boards Certify ${NP_TITLE}s?`,
    icon: 'award',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                'National certification is the step between graduation and a state license. The American Academy of Nurse ' +
                    'Practitioners Certification Board (AANPCB) and the American Nurses Credentialing Center (ANCC) each ' +
                    'certify nurse practitioners in several population foci:',
            ],
        },
        {
            kind: 'terms',
            items: [
                {
                    term: 'AANPCB',
                    detail: [
                        `Operating as NPCB, it offers family (FNP), adult-gerontology primary care (AGNP), ${BEHAVIORAL_PROSE} ` +
                            `(${BEHAVIORAL_ABBREVIATION}) and emergency (ENP) exams. Its certification is granted for 5 years, and its ` +
                            'credential is NP-C, which family NPs often show as FNP-C.',
                    ],
                },
                {
                    term: 'ANCC',
                    detail: [
                        'It offers family (FNP-BC), adult-gerontology primary care (AGPCNP-BC), adult-gerontology acute care ' +
                            `(AGACNP-BC) and ${BEHAVIORAL_PROSE} (${BEHAVIORAL_ABBREVIATION}-BC) certifications, and its ` +
                            'certifications renew every 5 years.',
                    ],
                },
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Both family NP exams require an active RN license, an accredited graduate family NP program and at least 500 ' +
                    'faculty-supervised clinical hours. Your scope of practice comes from state law and your license, not from ' +
                    'the board you certify with. Compare the family exams in ',
                { text: 'FNP certification: AANPCB vs ANCC', href: '/blog/fnp-certification-aanp-vs-ancc' },
                '.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                "Pediatric, neonatal and women's health NPs certify through other national boards, and the ",
                { text: 'NP certification overview', href: '/blog/np-certification-overview' },
                ' maps each credential to its board.',
            ],
        },
    ],
};

const LICENSURE: GuideSection = {
    id: 'licensure',
    heading: 'State Licensure and Practice Authority',
    icon: 'shield',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                'Certification makes you eligible; the state license lets you practice. Under the Consensus Model, the state ' +
                    "board of nursing licenses an APRN in a role and population focus that match the APRN's education and " +
                    `certification, and each state's law sets the scope of practice, including whether an ${NP} needs an ` +
                    'agreement with a physician.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'The American Association of Nurse Practitioners (AANP), a membership association, sorts state laws into three ' +
                    `practice environments. It classifies ${FULL_PRACTICE.formatted} as Full Practice (${FULL_PRACTICE.source}, ` +
                    `${FULL_PRACTICE.asOf}). ${getAanpTierDefinition('full')} In the other states, state law reduces or restricts ` +
                    `at least one element of ${NP} practice, for example through a collaborative agreement, supervision or team ` +
                    'management.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                "States in the same tier do not share one rule, and the classifications change as legislatures act. Find your state's own rule in the ",
                { text: 'scope of practice explorer', href: '/scope-of-practice' },
                ', read what each tier means in the ',
                { text: 'full practice authority guide', href: '/resources/fpa-guide' },
                ', and confirm the current rule with your state board of nursing before you rely on it.',
            ],
        },
    ],
};

const SPECIALTIES: GuideSection = {
    id: 'specialties',
    heading: `${NP_TITLE} Specialties and Population Foci`,
    icon: 'layers',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `Every ${NP} is educated, certified and licensed in a population focus, and the Consensus Model requires the ` +
                    'three to match. It names six foci: family/individual across the lifespan, adult-gerontology, pediatrics, ' +
                    `neonatal, women's health/gender-related and ${BEHAVIORAL_PROSE}.`,
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Within a focus, primary care and acute care NPs have separate certification processes, which is why ' +
                    `adult-gerontology NPs certify as either AGPCNP or AGACNP. These are the ${NP} tracks by population focus, ` +
                    `each linked to its jobs on ${brand.name}:`,
            ],
        },
        {
            kind: 'cards',
            items: [
                {
                    abbreviation: 'FNP',
                    name: 'Family Nurse Practitioner',
                    focus: 'Focus: family/individual across the lifespan, so patients of every age',
                    link: { text: `Family practice ${NP} jobs`, href: '/jobs/family-practice' },
                },
                {
                    abbreviation: 'AGPCNP',
                    name: 'Adult-Gerontology Primary Care NP',
                    focus: 'Focus: adults, including older adults, in primary care',
                    link: { text: `Adult-gerontology ${NP} jobs`, href: '/jobs/adult-gerontology' },
                },
                {
                    abbreviation: 'AGACNP',
                    name: 'Adult-Gerontology Acute Care NP',
                    focus: 'Focus: adults, including older adults, in acute care',
                    link: { text: `Acute care ${NP} jobs`, href: '/jobs/acute-care' },
                },
                {
                    abbreviation: 'PNP',
                    name: 'Pediatric Nurse Practitioner',
                    focus: 'Focus: children, in primary care or acute care',
                    link: { text: `Pediatric ${NP} jobs`, href: '/jobs/pediatric' },
                },
                {
                    abbreviation: BEHAVIORAL_ABBREVIATION,
                    name: `${BEHAVIORAL_NAME} Nurse Practitioner`,
                    focus: `Focus: ${BEHAVIORAL_PROSE} across the lifespan`,
                    link: { text: `${BEHAVIORAL_NAME} ${NP} jobs`, href: `/jobs/${BEHAVIORAL_SLUG}` },
                },
                {
                    abbreviation: 'WHNP',
                    name: "Women's Health Nurse Practitioner",
                    focus: "Focus: women's health/gender-related care",
                    link: { text: `Women's health ${NP} jobs`, href: '/jobs/women-health' },
                },
                {
                    abbreviation: 'NNP',
                    name: 'Neonatal Nurse Practitioner',
                    focus: 'Focus: newborns',
                    link: { text: `Neonatal ${NP} jobs`, href: '/jobs/neonatal' },
                },
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Specialties such as ',
                { text: 'dermatology', href: '/jobs/dermatology' },
                ', ',
                { text: 'cardiology', href: '/jobs/cardiology' },
                ' and ',
                { text: 'oncology', href: '/jobs/oncology' },
                ' add depth within a focus. The Consensus Model says APRNs may specialize but cannot be licensed solely within ' +
                    `a specialty area, so an ${NP} who works in dermatology is still licensed in a population focus such as family.`,
            ],
        },
    ],
};

const PAY: GuideSection = {
    id: 'pay',
    heading: `How Much Do ${NP_TITLE}s Make?`,
    icon: 'wallet',
    blocks: [
        {
            kind: 'stats',
            items: [
                { value: NP_MEDIAN, label: 'Median annual wage' },
                { value: NP_P10, label: 'Lowest 10% earn less than' },
                { value: NP_P90, label: 'Top 10% earn more than' },
            ],
            caption: [`${STAT_SOURCES.averageSalary.source}; the percentiles are from the same release.`],
        },
        {
            kind: 'paragraph',
            content: [
                `BLS reports a median annual wage of ${NP_MEDIAN} for nurse practitioners in ${PAY_VINTAGE}, with the 10th ` +
                    `percentile at ${NP_P10} and the 90th percentile at ${NP_P90}. The figures cover every specialty, setting and ` +
                    'experience level, so a single offer can sit well above or below the median.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'For pay by state, setting and specialty, the ',
                { text: `${NP} salary guide`, href: '/salary-guide' },
                ' reports medians from live postings once enough employers disclose pay.',
            ],
        },
    ],
};

const OUTLOOK: GuideSection = {
    id: 'outlook',
    heading: `What Is the Job Outlook for ${NP_TITLE}s?`,
    icon: 'trending',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `BLS projects nurse practitioner employment to grow ${NP_GROWTH} from ${CYCLE.from} to ${CYCLE.to}, from ` +
                    `${NP_JOBS.jobsBase} jobs to ${NP_JOBS.jobsProjected}, an increase of ${NP_JOBS.change}. Nurse practitioners ` +
                    'appear in the BLS table of the fastest growing occupations for that period.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'A national projection is not a local forecast. Our ',
                { text: `${NP} job outlook guide`, href: '/blog/nurse-practitioner-job-outlook' },
                ' looks at what it means for a given market and specialty.',
            ],
        },
    ],
};

const SETTINGS: GuideSection = {
    id: 'settings',
    heading: `Where Do ${NP_TITLE}s Work?`,
    icon: 'mapPin',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                "Nurse practitioners give primary and acute care across settings. BLS lists hospitals, physicians' offices and " +
                    'clinics among the places APRNs work, and offices of physicians, hospitals and outpatient care centers are ' +
                    'among the largest employers of nurse anesthetists, nurse midwives and nurse practitioners as a group.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'Some roles are remote or telehealth. Before you take one, ask which states your patients will be in, because ' +
                    'each of those states sets its own APRN licensure rules, and confirm them with each state board of nursing.',
            ],
        },
        {
            kind: 'links',
            items: [
                { text: `Remote ${NP} jobs`, href: '/jobs/remote' },
                { text: `Telehealth ${NP} jobs`, href: '/jobs/telehealth' },
                { text: `Hospital ${NP} jobs`, href: '/jobs/hospital' },
                { text: `Primary care ${NP} jobs`, href: '/jobs/primary-care' },
                { text: `All ${NP} jobs`, href: '/jobs' },
            ],
        },
    ],
};

const DNP_VS_NP: GuideSection = {
    id: 'dnp-vs-np',
    heading: `DNP vs ${NP}: What Is the Difference?`,
    icon: 'compass',
    blocks: [
        {
            kind: 'paragraph',
            content: [
                `${NP} is a licensed role, and DNP is a degree. The American Association of Colleges of Nursing (AACN) describes ` +
                    'the Doctor of Nursing Practice as a terminal degree in nursing practice and an alternative to research-focused ' +
                    "doctoral programs. A nurse practitioner can enter practice with a master's degree, a post-graduate certificate " +
                    'or a DNP, and both family NP certification boards accept all three.',
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'On October 25, 2004, AACN member schools voted to endorse a position statement calling for the preparation for ' +
                    "advanced nursing practice to move from the master's degree to the doctoral level, and in 2018 the National " +
                    'Organization of Nurse Practitioner ' +
                    'Faculties (NONPF) called for the DNP as entry-level NP preparation by 2025, a position it reaffirmed in April ' +
                    '2023, according to AACN. These are education goals, not licensing rules: the certification boards above still ' +
                    "accept a master's degree.",
            ],
        },
        {
            kind: 'paragraph',
            content: [
                'A DNP does not change the license. The state board of nursing licenses the NP role and population focus, and ' +
                    `state law sets the scope of practice whatever the degree. An ${NP} with a DNP holds a nursing doctorate, not a ` +
                    'medical degree such as an MD or DO.',
            ],
        },
    ],
};

// ─── FAQ ─────────────────────────────────────────────────────────────────────

/** One array for the visible FAQ and the FAQPage markup (guide-model.ts), so the two cannot drift. */
const FAQS: readonly FaqItem[] = [
    {
        question: `What does ${NP} stand for in medical terms?`,
        answer: [
            `${NP} stands for ${NP_PROSE}, an advanced practice registered nurse (APRN) educated and certified in a population ` +
                'focus, such as family or pediatrics. NPs assess and diagnose patients, order tests, manage treatment and prescribe ' +
                'medication within the limits of state law. The Consensus Model for APRN Regulation calls the role certified nurse ' +
                'practitioner (CNP).',
        ],
    },
    {
        question: `Is a ${NP_PROSE} a doctor?`,
        answer: [
            'A nurse practitioner is not a physician. Physicians hold a Medical Doctor (MD) or Doctor of Osteopathic Medicine (DO) ' +
                'degree and, according to BLS, complete 3 to 9 years of internship and residency after medical school, depending ' +
                    'on the specialty. NPs are ' +
                `registered nurses with graduate nursing education. An ${NP} who earns a Doctor of Nursing Practice (DNP) holds a ` +
                'nursing doctorate, not a medical degree.',
        ],
    },
    {
        question: `Can ${NP_PROSE}s prescribe medication?`,
        answer: [
            'Yes, within state law. Prescribing is part of the NP role in the Consensus Model, and BLS notes that many nurse ' +
                'practitioners prescribe medications and order laboratory tests, although the scope of their duties varies by ' +
                'state. Each state sets its own conditions, such as whether a collaborative agreement is needed, so check the ',
            { text: 'scope of practice explorer', href: '/scope-of-practice' },
            ' and your state board of nursing.',
        ],
    },
    {
        question: `How long does it take to become a ${NP_PROSE}?`,
        answer: [
            'It depends on where you start. You need an RN license first, then a graduate NP program (an MSN, a post-graduate ' +
                'certificate or a DNP) whose length each school sets, then national certification and a state APRN license. Ask ' +
                'each program for its plan of study and expected completion date, and see our guide on ',
            { text: 'how to become a nurse practitioner', href: '/blog/how-to-become-a-nurse-practitioner' },
            '.',
        ],
    },
    {
        question: `What is the difference between a DNP and an ${NP}?`,
        answer: [
            `${NP} is a licensed role, and DNP is a degree. AACN describes the Doctor of Nursing Practice as a terminal degree in ` +
                "nursing practice. Nurse practitioners can enter practice with a master's degree, a post-graduate certificate or a " +
                'DNP, and both family NP certification boards accept all three. The degree does not change the license or the ' +
                "state's scope of practice rules.",
        ],
    },
    {
        question: `What is the difference between an ${NP} and a PA?`,
        answer: [
            'Both diagnose and treat patients, but they train under different models. NPs are registered nurses with graduate ' +
                'nursing education, certified in a population focus. PAs typically need a master\'s degree from an accredited PA ' +
                'program and pass the Physician Assistant National Certifying Examination (PANCE). BLS reports that in most states ' +
                `PAs must hold an agreement with a supervising physician, while AANP classifies ${FULL_PRACTICE.formatted} as Full ` +
                'Practice for NPs. Our ',
            { text: `${NP} vs PA guide`, href: '/resources/np-vs-pa' },
            ' compares the roles in detail.',
        ],
    },
    {
        question: `How much do ${NP_PROSE}s make?`,
        answer: [
            `BLS reports a median annual wage of ${NP_MEDIAN} for nurse practitioners in ${PAY_VINTAGE}, with the 10th percentile ` +
                `at ${NP_P10} and the 90th at ${NP_P90}. The median covers every specialty, setting and experience level. For pay ` +
                'by state and setting, see the ',
            { text: `${NP} salary guide`, href: '/salary-guide' },
            '.',
        ],
    },
];

// ─── Sources and figures ─────────────────────────────────────────────────────

const SOURCES: readonly SourceLink[] = [
    {
        ...PRIMARY_SOURCES.consensusModel,
        note: 'the four APRN roles, the six population foci and the rule that education, certification and licensure match',
    },
    {
        ...PRIMARY_SOURCES.blsOohNp,
        note: 'what nurse practitioners do, how they are educated and licensed, and where APRNs work',
    },
    { label: STAT_SOURCES.averageSalary.source, url: STAT_SOURCES.averageSalary.sourceUrl, note: 'the NP median wage and its 10th and 90th percentiles' },
    {
        label: STAT_SOURCES.blsGrowth2035.source,
        url: STAT_SOURCES.blsGrowth2035.sourceUrl,
        note: 'projected NP growth and NP employment at the start and end of the projection period',
    },
    {
        label: FULL_PRACTICE.source,
        url: FULL_PRACTICE.sourceUrl,
        note: `practice environment classifications, ${FULL_PRACTICE.asOf}`,
    },
    { ...PRIMARY_SOURCES.blsOohRn, note: 'the education paths and licensing of registered nurses' },
    { ...PRIMARY_SOURCES.blsOohPhysicians, note: 'physician degrees, medical school and residency length, and licensing' },
    { ...PRIMARY_SOURCES.blsOohPa, note: 'physician assistant education, licensing and supervision agreements' },
    { ...PRIMARY_SOURCES.nccpaCertify, note: 'the PANCE and the PA-C credential' },
    { ...PRIMARY_SOURCES.anccFnp, note: 'FNP-BC eligibility, clinical hours and the length of the credential' },
    { ...PRIMARY_SOURCES.anccCertifications, note: 'the nurse practitioner certifications ANCC offers' },
    { ...PRIMARY_SOURCES.anccRenewals, note: 'the ANCC renewal cycle' },
    { ...PRIMARY_SOURCES.aanpcb, note: 'the nurse practitioner exams AANPCB offers' },
    { ...PRIMARY_SOURCES.aanpcbFnpHandbook, note: 'FNP eligibility, clinical hours, the certification period and the NP-C credential' },
    { ...PRIMARY_SOURCES.aacnDnp, note: 'what the DNP is, the AACN position statement and the NONPF goal' },
];

/** Every figure the copy prints that is not read from lib/stats-sources.ts. */
const FIGURES: readonly VerifiedFigure[] = [
    { text: '2008', claim: 'year of the Consensus Model for APRN Regulation', sourceUrl: PRIMARY_SOURCES.consensusModel.url },
    { text: 'four', claim: 'APRN roles in the Consensus Model', sourceUrl: PRIMARY_SOURCES.consensusModel.url },
    { text: 'six', claim: 'population foci in the Consensus Model', sourceUrl: PRIMARY_SOURCES.consensusModel.url },
    { text: 'three', claim: 'education, certification and licensure, which must match', sourceUrl: PRIMARY_SOURCES.consensusModel.url },
    { text: 'three', claim: 'education paths to RN practice', sourceUrl: PRIMARY_SOURCES.blsOohRn.url },
    { text: 'three', claim: "degree types both family NP boards accept (master's, post-graduate certificate, DNP)", sourceUrl: PRIMARY_SOURCES.anccFnp.url },
    { text: 'three', claim: 'practice environments AANP uses', sourceUrl: FULL_PRACTICE.sourceUrl },
    { text: '4', claim: 'years of medical school', sourceUrl: PRIMARY_SOURCES.blsOohPhysicians.url },
    { text: '3 to 9', claim: 'years of internship and residency for physicians', sourceUrl: PRIMARY_SOURCES.blsOohPhysicians.url },
    { text: '500', claim: 'minimum faculty-supervised clinical hours for the ANCC family exam', sourceUrl: PRIMARY_SOURCES.anccFnp.url },
    { text: '500', claim: 'minimum faculty-supervised direct patient care hours for the AANPCB family exam', sourceUrl: PRIMARY_SOURCES.aanpcbFnpHandbook.url },
    { text: '5', claim: 'years an AANPCB certification is granted for', sourceUrl: PRIMARY_SOURCES.aanpcbFnpHandbook.url },
    { text: '5', claim: 'years between ANCC renewals', sourceUrl: PRIMARY_SOURCES.anccRenewals.url },
    { text: NP_JOBS.jobsBase, claim: `NP employment in ${CYCLE.from}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: NP_JOBS.jobsProjected, claim: `projected NP employment in ${CYCLE.to}`, sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: NP_JOBS.change, claim: 'projected change in NP employment', sourceUrl: BLS_PROJECTIONS.sourceUrl },
    { text: 'October 25, 2004', claim: 'AACN member schools endorse the practice doctorate position statement', sourceUrl: PRIMARY_SOURCES.aacnDnp.url },
    { text: '2018', claim: 'NONPF calls for the DNP as entry-level NP preparation', sourceUrl: PRIMARY_SOURCES.aacnDnp.url },
    { text: '2025', claim: 'the target year of the NONPF goal', sourceUrl: PRIMARY_SOURCES.aacnDnp.url },
    { text: 'April 2023', claim: 'NONPF reaffirms the goal', sourceUrl: PRIMARY_SOURCES.aacnDnp.url },
];

export const WHAT_IS_A_NURSE_PRACTITIONER: GuideContent = {
    path: WHAT_IS_A_NURSE_PRACTITIONER_PATH,
    datePublished: PAGE_DATE,
    dateModified: PAGE_DATE,
    title: `What Is a ${NP_TITLE} (${NP})? Role and Path`,
    description:
        `${NP} meaning: a ${NP_PROSE} is an advanced practice registered nurse. What NPs do, how to become one, ` +
        'certification, specialties, DNP vs NP and pay.',
    keywords: [
        'what is a nurse practitioner',
        'np meaning',
        'what does np stand for in medical terms',
        'nurse practitioner definition',
        'dnp vs np',
        'how to become a nurse practitioner',
        'nurse practitioner specialties',
    ],
    h1: `What Is a ${NP_TITLE} (${NP})?`,
    crumb: `What Is a ${NP_TITLE}?`,
    ogTitle: `What Is a ${NP_TITLE} (${NP})?`,
    quickAnswer: QUICK_ANSWER,
    heroTone: 'pink',
    heroIcon: 'stethoscope',
    sections: [MEANING, ROLE, COMPARISON, BECOME, CERTIFICATION, LICENSURE, SPECIALTIES, PAY, OUTLOOK, SETTINGS, DNP_VS_NP],
    faqHeading: 'Frequently Asked Questions',
    faqs: FAQS,
    sources: SOURCES,
    sourcesNote:
        `${brand.name} checked every figure on this page against these sources on the review date above. Practice, ` +
        'certification and licensure rules change, so confirm them with the certifying body and your state board of ' +
        'nursing before you act on them.',
    figures: FIGURES,
    related: [
        {
            href: '/resources/np-vs-pa',
            title: `${NP} vs PA`,
            description: 'Education, clinical hours, certification, practice authority and pay, side by side.',
        },
        {
            href: '/blog/what-is-an-aprn',
            title: 'What is an APRN?',
            description: 'The four advanced practice nursing roles and the six population foci.',
        },
        {
            href: '/blog/how-to-become-a-nurse-practitioner',
            title: 'How to become a nurse practitioner',
            description: 'The steps from an RN license to certification and a state APRN license.',
        },
        {
            href: '/scope-of-practice',
            title: 'Scope of practice by state',
            description: "Each state's practice authority rule, with board of nursing links.",
        },
    ],
    cta: {
        heading: `Find ${NP} Jobs`,
        primary: { text: `Browse ${NP} Jobs`, href: '/jobs' },
        secondary: { text: 'View Salary Guide', href: '/salary-guide' },
    },
};

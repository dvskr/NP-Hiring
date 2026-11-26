import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/compensation-report. Every figure restates the
 * 2026 NP Compensation Report with its source and vintage beside it: BLS
 * figures are May 2025, AANP figures are from AANP's 2024 report (2023
 * earnings, as the report's source list dates them), postings are from
 * October 2026.
 *
 * The excerpt quotes printed pages 1, 2, 5 and 6 as the PDF prints them:
 * the summary's pay at a glance and top-paying states, all of Chapter 1 and
 * the opening of Chapter 2 with its percentile table. The changes: the AANP
 * source cell in the pay table carries its earnings year, and the ** around
 * the run-in leads the PDF sets in bold. The summary's specialty, posting
 * and question sections are left out; the page answers those in its own
 * words below. Nothing else from the PDF belongs in this repository.
 */
export const COMPENSATION_REPORT_PREVIEW: GuidePreview = {
    noun: 'report',
    seo: {
        title: 'Nurse Practitioner Compensation 2026 Report',
        description: 'What nurse practitioners earn in 2026 by state, specialty and setting, from BLS and AANP data. Read the report summary, its methodology and the pay curve.',
    },
    h1: 'Nurse Practitioner Compensation: The 2026 NP Compensation Report',
    intro: "Nurse practitioner compensation in 2026 starts from one baseline: a $132,300 median wage, or $63.61 an hour, in May 2025, according to BLS. The middle half of NPs earned $117,990 to $156,700, and the top 10% more than $174,420. California paid the most, with a $168,520 median. The summary's pay tables and all of Chapter 1 are below, with the pay curve from Chapter 2.",
    edition: { name: 'October 2026', updated: '2026-10-24' },
    contentDate: '2026-11-27',
    excerpt: {
        heading: "Read the summary's pay tables and Chapter 1",
        note: 'Printed pages 1, 2, 5 and 6 of the report: pay at a glance, the top-paying states, how the report ranks its five sources, and the opening of Chapter 2 with the BLS percentile table.',
        pages: [1, 2, 5, 6],
        body: `
## Summary

U.S. nurse practitioners earned a median of $132,300 ($63.61 per hour) in May 2025, according to BLS. The middle half earned $117,990 to $156,700, and the top 10% earned more than $174,420.

### 2026 NP pay at a glance

| Measure | Figure | Source |
| Median wage, all NPs | $132,300 ($63.61 per hour) | BLS OEWS, May 2025 |
| Mean wage, all NPs | $137,300 ($66.01 per hour) | BLS OEWS, May 2025 |
| Middle half of NPs | $117,990 to $156,700 | BLS OEWS, May 2025 |
| Top 10% of NPs | Above $174,420 | BLS OEWS, May 2025 |
| Employed NPs | 323,040 | BLS OEWS, May 2025 |
| Full-time median base salary, all NPs | $120,000 | AANP 2024 report (2023 earnings) |
| NP job growth, 2025 to 2035 | +41% (336,300 to 474,100 jobs) | BLS Employment Projections |

The two job counts come from different BLS programs: the OEWS survey counted 323,040 NP jobs in May 2025, while Employment Projections start from a broader 2025 base of 336,300.

### Top-paying states for NPs (BLS median, May 2025)

| Rank | State | Median annual wage | AANP practice authority |
| 1 | California | $168,520 | Restricted |
| 2 | New Jersey | $159,310 | Reduced |
| 3 | Washington | $156,100 | Full |
| 4 | Oregon | $155,680 | Full |
| 5 | Alaska | $155,170 | Full |
| 6 | New York | $153,510 | Full |

The lowest medians were Alabama at $105,750 and Tennessee at $117,590. Chapter 3 lists all 50 states and the District of Columbia.

## Chapter 1: Methodology and Source Hierarchy

BLS is the only source that counts all 323,040 employed U.S. NPs, so it is the baseline for this report. Specialty pay comes from four weaker sources, used in a fixed order of trust.

### The five sources, ranked

| Rank | Source | What it measures | Who is counted | Main limit | How this report uses it |
| 1 | BLS Occupational Employment and Wage Statistics (OEWS), May 2025 | W-2 wages reported by employers | Employed NPs (SOC 29-1171); excludes the self-employed | Excludes benefits; no figure by NP specialty | Baseline for national, state and setting pay |
| 2 | AANP compensation data | Self-reported total compensation | NPs who answer AANP's survey | Self-reported; sample can skew | Specialty premium (psychiatry, family, dermatology) |
| 3 | Medscape APRN Compensation Report 2025 | Self-reported total compensation | Opt-in respondents | Opt-in sample; 2024 pay | Cross-check |
| 4 | Job postings (Talkiatry, LifeStance, Headway, Barton Associates) | Asking ranges and advertised rates | Open roles, usually for experienced hires | Not what people are paid; top of range is rare | Ceiling check and telehealth trend |
| 5 | Aggregators (Marit Health, Salary.com, Glassdoor, Indeed) | Mixed postings and user reports | Varies | Methods not fully published | Sanity check only, labeled as such |

### Rules this report follows

**BLS first.** Every state and setting figure comes from BLS OEWS May 2025 estimates for SOC 29-1171, the latest release as of October 2026.

**Medians before means.** A few high earners raise the mean. The national mean ($137,300) is $5,000 above the median ($132,300).

**Base vs. total pay labeled.** BLS reports wages without benefits. AANP and Medscape report total compensation.

**Postings labeled as postings.** A posted range is what an employer may pay a strong candidate, not the market middle.

**Aggregators labeled as aggregators.** Where verified specialty data does not exist (acute care, emergency, urgent care, pediatrics, women's health), this report shows aggregator figures and says so.

### What BLS can and cannot tell you

BLS publishes one wage set for all nurse practitioners. It cannot separate an FNP from an AGACNP or a PNP.

BLS does publish pay by employer industry, such as hospitals, physician offices and outpatient centers. Those setting rows are the closest official proxy for specialty pay (Chapter 4).

## Chapter 2: National Pay Distribution

The middle half of U.S. nurse practitioners earned $117,990 to $156,700 in May 2025, around a median of $132,300. The top 10% earned more than $174,420, which is 1.72 times the 10th-percentile wage of $101,340.

### BLS percentile table, all NPs (May 2025)

| Percentile | Annual wage | Hourly wage | What it usually means |
| 10th | $101,340 | $48.72 | New graduates, low-cost states, some part-time W-2 roles |
| 25th | $117,990 | $56.73 | Early-career NPs in average-cost states |
| 50th (median) | $132,300 | $63.61 | The typical employed NP |
| Mean | $137,300 | $66.01 | Pulled up by high earners |
| 75th | $156,700 | $75.34 | Experienced NPs, high-cost states, higher-paying specialties |
| 90th | $174,420 | $83.86 | Top states, dermatology and acute care roles, heavy productivity pay |

BLS counted 323,040 employed NPs in May 2025. Its hourly figures assume 2,080 paid hours a year, so annual equals hourly × 2,080.
`,
        bridge: 'That is the summary, Chapter 1 and the start of Chapter 2 of 10. The full report adds the state-by-state table for all 50 states and DC, specialty and setting pay, telehealth and 1099 math, RVU pay, pay bands by career stage, five market risks and a negotiation method.',
    },
    disclaimer: 'This report is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        {
            title: 'Summary',
            page: 1,
            sections: [
                '2026 NP pay at a glance',
                'Top-paying states for NPs (BLS median, May 2025)',
                'Specialty premium',
                'Telehealth and in-person postings, October 2026',
                'Frequently asked questions',
            ],
        },
        { title: 'About This Report', page: 4, sections: [] },
        {
            chapter: 1,
            title: 'Methodology and Source Hierarchy',
            page: 5,
            inExcerpt: true,
            sections: ['The five sources, ranked', 'Rules this report follows', 'What BLS can and cannot tell you'],
        },
        {
            chapter: 2,
            title: 'National Pay Distribution',
            page: 6,
            sections: ['BLS percentile table, all NPs (May 2025)', 'Where specialty figures sit on this curve', 'Reading the curve by specialty'],
        },
        {
            chapter: 3,
            title: 'State-by-State Pay Table',
            page: 7,
            sections: [
                'How to read this table',
                'BLS May 2025 NP wages by state, with AANP practice authority',
                'Does practice authority predict pay?',
                'Three notes on state pay',
            ],
        },
        {
            chapter: 4,
            title: 'Specialty and Setting',
            page: 10,
            sections: [
                'Specialty comparison: verified AANP figures',
                'Specialty comparison: aggregator figures (sanity check only)',
                'Pay by work setting (BLS, May 2025, all NPs)',
                'What the setting data tells you',
            ],
        },
        {
            chapter: 5,
            title: 'Telehealth vs. In-Person Pay',
            page: 13,
            sections: [
                'October 2026 postings and rates',
                'Telehealth pay models by specialty',
                'Per-visit fees you need to break even',
                'Telehealth risks that can move pay',
            ],
        },
        {
            chapter: 6,
            title: 'W-2 vs. 1099 Pay',
            page: 16,
            sections: [
                'The formula',
                'Worked example: replacing a $150,000 W-2 NP job',
                'Break-even rates by salary (all NPs, fixed costs about $17,408)',
                'Testing common 1099 rates',
                'Taxes you take on as a 1099 NP',
            ],
        },
        {
            chapter: 7,
            title: 'RVU and Productivity Pay',
            page: 18,
            sections: [
                '2026 Medicare numbers that drive productivity pay',
                'Common E/M work RVUs',
                'The minimum $/wRVU you need',
                'Questions to ask about any RVU offer',
            ],
        },
        {
            chapter: 8,
            title: 'New Graduate vs. Experienced Pay',
            page: 20,
            sections: [
                'Pay bands by career stage',
                'New-grad notes by specialty',
                'Transition-to-practice hours that unlock higher pay',
                'Credentials that add verified pay',
                'First-offer rules for new NPs',
            ],
        },
        {
            chapter: 9,
            title: 'Job Outlook and Five Market Risks',
            page: 23,
            sections: ['What the outlook means by specialty', 'Five market risks, with dates', 'Enforcement is also a pay risk'],
        },
        {
            chapter: 10,
            title: 'How to Use This Data in Negotiation',
            page: 25,
            sections: ['The three numbers', 'Worked examples', 'Turn every offer into comparable numbers', 'Counteroffer script', 'Negotiation checklist'],
        },
        { title: 'Sources and Update Log', page: 28, sections: [] },
    ],
    keyFigures: [
        {
            title: 'Widest state gap',
            figure: '$62,770',
            text: "California's NP median of $168,520 against Alabama's $105,750, the highest and lowest of 50 states and DC. Only 21 of those 51 medians beat the national figure. The full report ranks all 51 with their AANP practice authority.",
            source: 'BLS OEWS, May 2025, all NPs (Chapter 3)',
        },
        {
            title: 'Specialty premium',
            figure: '+32.5%',
            text: 'Dermatology NPs report mean total compensation of $165,921, against $125,226 for family practice NPs; psychiatry sits between them at $147,898. BLS does not publish NP wages by specialty, so these are survey figures (2023 earnings).',
            source: 'AANP 2024 report, 2023 earnings (Chapter 4)',
        },
        {
            title: 'Pay by work setting',
            text: 'Physician offices are the largest NP employer by far, at a median a little under the national figure. Hospital and outpatient center roles pay more.',
            table: {
                columns: ['Setting', 'NPs employed', 'Median wage'],
                rows: [
                    ['Physician offices', '148,600', '$129,190'],
                    ['General hospitals', '73,610', '$136,230'],
                    ['Outpatient care centers', '31,590', '$139,320'],
                    ['State government', '1,380', '$120,230'],
                ],
            },
            source: 'BLS OEWS, May 2025, all NPs (Chapter 4)',
        },
        {
            title: 'W-2 to 1099 break-even',
            figure: '$108.75 an hour',
            text: 'What a 1099 role must pay per billable hour, at 1,700 hours a year, to replace a $150,000 W-2 job once you cover your own benefits, payroll tax, malpractice, licenses and CE. That is about 1.5 times the $72.12 W-2 hourly figure. Run your own numbers in the 1099 vs W-2 calculator.',
            link: { phrase: '1099 vs W-2 calculator', href: '/tools/1099-vs-w2-calculator' },
            source: 'Report calculation, October 2026 (Chapter 6)',
        },
        {
            title: 'New graduate to experienced',
            text: 'A new-graduate primary care NP in a state with typical living costs usually starts at $101,340 to $117,990. Experienced NPs in better-paying specialties or states reach $156,700 to $174,420. For advertised pay on open roles, see new grad NP jobs.',
            link: { phrase: 'new grad NP jobs', href: '/jobs/new-grad' },
            source: 'Chapter 8, on BLS OEWS, May 2025',
        },
    ],
    faqHeading: 'Common questions about nurse practitioner pay',
    faq: [
        {
            question: 'How much does a nurse practitioner make in 2026?',
            answer: "The latest BLS figures, for May 2025, put the median NP wage at $132,300 a year, or $63.61 an hour, and the mean at $137,300. The middle half of NPs earned $117,990 to $156,700. AANP's 2024 report (2023 earnings) puts the full-time median base salary at $120,000, lower because AANP measures base salary alone. For state medians and advertised pay on live postings, see the nurse practitioner salary guide.",
            link: { phrase: 'nurse practitioner salary guide', href: '/salary-guide' },
        },
        {
            question: 'Which nurse practitioner specialty pays the most?',
            answer: "In AANP's 2024 report (2023 earnings), dermatology NPs report the highest mean total compensation, $165,921, followed by psychiatry at $147,898; family practice NPs report $125,226. BLS publishes no NP wage by specialty, so the report uses BLS pay by work setting as the official proxy, and labels aggregator figures as such where no verified data exists, as with acute care, emergency, urgent care, pediatrics and women's health. See how the highest-paying NP specialties compare.",
            link: { phrase: 'highest-paying NP specialties', href: '/blog/highest-paying-np-specialties' },
        },
        {
            question: 'Which state pays nurse practitioners the most?',
            answer: 'California, with a BLS median of $168,520 in May 2025, followed by New Jersey at $159,310 and Washington at $156,100. Alabama had the lowest median, $105,750. The full report lists every state and DC with its mean, its rank, its NP job count and its AANP practice authority.',
        },
        {
            question: 'How much do new grad NPs make?',
            answer: 'A new-graduate primary care NP in a state with typical living costs usually starts between $101,340 and $117,990, the band from the 10th to the 25th BLS percentile in May 2025. Specialty, setting and state move that number: hospital roles pay more but often add nights, weekends or 12-hour shifts, and urgent care is often paid by the hour.',
        },
        {
            question: 'How much do telehealth nurse practitioners make?',
            answer: 'Public figures are posted pay, not what the typical NP is paid. In October 2026, a virtual primary care role at One Medical listed $59.10 to $65.50 an hour plus evening and weekend differentials, and an Included Health posting for virtual primary care went up to $130,000 plus equity. Remote W-2 telepsychiatry postings at Talkiatry went up to $215,000. Convert hourly and per-visit pay to a yearly figure before you compare offers.',
        },
        {
            question: 'How do you compare a 1099 rate with a W-2 salary?',
            answer: 'A 1099 hourly rate must be about 1.5 times the W-2 hourly equivalent to break even, because you pay your own benefits, the employer half of payroll tax, malpractice and licenses. A $150,000 salary works out to $72.12 an hour, so the matching 1099 rate is about $108.75 per billable hour. The report runs the same math for other salaries up to $220,000, and the 1099 vs W-2 comparison covers the tax side.',
            link: { phrase: '1099 vs W-2 comparison', href: '/resources/1099-vs-w2' },
        },
        {
            question: 'Is the NP job market still growing?',
            answer: 'Yes. BLS projects 41% growth from 2025 to 2035, from 336,300 to 474,100 jobs, the fastest of any occupation. The full report adds five dated risks to the market, from Medicaid budget pressure to practice authority changes, and what each could do to pay. For more on demand by setting, read the nurse practitioner job outlook.',
            link: { phrase: 'nurse practitioner job outlook', href: '/blog/nurse-practitioner-job-outlook' },
        },
    ],
};

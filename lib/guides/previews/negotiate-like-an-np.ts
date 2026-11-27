import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/negotiate-like-an-np, aimed at contract
 * negotiation; the blog's salary negotiation post keeps that phrase. Every
 * figure restates Negotiate Like an NP: BLS figures are May 2025, AANP
 * figures are from AANP's 2024 report (2023 earnings), the malpractice and
 * tail figures are the carriers' and brokers' as the guide cites them.
 *
 * The excerpt quotes printed pages 6 to 10 as the PDF prints them: Chapter
 * 1's "Set your three numbers" and all of Chapter 2. The changes: the AANP
 * figure in the three numbers table carries its earnings year, the total
 * compensation formula sits on its own line, where text extraction runs it
 * into the next sentence, and ** marks the run-in leads the PDF sets in
 * bold. Chapter 4's licenses line, whose parts do not add up to its total,
 * appears nowhere on the page.
 */
export const NEGOTIATE_LIKE_AN_NP_PREVIEW: GuidePreview = {
    noun: 'guide',
    seo: {
        title: 'Nurse Practitioner Contract Negotiation Guide',
        description: 'Set a walk-away, a target and an ask, then price every benefit in an NP offer. Read Chapter 2 of the guide with scripts and a 20-point contract audit.',
    },
    h1: 'Nurse Practitioner Contract Negotiation: Negotiate Like an NP',
    intro: 'Negotiate the whole package, not the salary alone. Around a $150,000 W-2 salary, benefits and costs the employer pays are worth about $34,883 a year, because replacing them as a 1099 contractor costs $184,883. Before the first call, set three numbers, a walk-away, a target and an ask, and tie each one to a source you can name.',
    edition: { name: 'January 2027', updated: '2026-11-27' },
    contentDate: '2026-11-27',
    excerpt: {
        heading: 'Read Chapter 2: Total Compensation, Not Salary',
        note: 'Printed pages 6 to 10 of the guide: the three numbers that close Chapter 1, then all of Chapter 2, from what each benefit is worth to the costs NPs forget to price.',
        pages: [6, 7, 8, 9, 10],
        body: `
### Set your three numbers

1. **Walk-away number:** the lowest total package you will accept. For a 1099 role, it is your break-even rate from Chapter 4.

2. **Target:** the number your data supports, built from your state median, your specialty figure and matching postings.

3. **Ask:** the number you say first. Set it at the top of a range you can defend with a named source.

| Number | Example: new-grad FNP, average-cost state | Example: experienced FNP, primary care | Evidence | Your number |
| Walk-away | $110,000 | $125,000 | Inside the BLS 10th to 25th percentile band; near AANP's family practice figure |  |
| Target | $117,990 | $140,000 | BLS 25th percentile; between the BLS median and 75th percentile |  |
| Ask | $125,000 | $156,700 | Near AANP's $125,226 family practice figure (2023 earnings); the BLS 75th percentile |  |

## Chapter 2: Total Compensation, Not Salary

The package around a $150,000 W-2 salary is worth about $34,883 a year, because replacing it as a 1099 contractor costs $184,883 (Chapter 4). Price every item below before you compare offers or decide what to trade.

### What each item is worth

| Item | How to value it | What to ask | Reference figure |
| Base salary | Face value, if guaranteed | Is this a guaranteed salary or a draw against production? | Chapter 1 anchors |
| Shift differentials | Extra $/hour × expected night, weekend and holiday hours | What are the differentials, and how many of those shifts will I work? | Common in urgent care, emergency and hospital roles |
| Productivity or quality bonus | The payout you will realistically earn, not the maximum | What share of NPs here earned the full bonus last year? | Ask for the formula in writing |
| Sign-on bonus | Amount ÷ years of required service | Is repayment prorated if I leave early? | Spread over the commitment |
| Retention bonus | Count only the years you expect to stay | When is it paid, and is it guaranteed? |  |
| Relocation | Your real moving cost covered | What triggers repayment? |  |
| Health insurance | Employer share of the premium | What is my monthly premium for my coverage tier? | $9,000 a year for an individual marketplace estimate |
| Retirement match | Match % × salary, then check vesting | What is the vesting schedule? | 4% of $150,000 = $6,000 |
| Disability and life insurance | Premium you would pay yourself | Is disability coverage "own occupation"? | About $1,500 a year |
| Malpractice | Premium you would pay yourself | Claims-made or occurrence? What limits? | $1,838, CM&F full-time family and urgent care NP average at $1M/$3M; Florida and New York run higher |
| Tail coverage | 150 to 250% of a year's premium (Leavitt); "200% or more" (CM&F); 200 to 350% (Griffith E. Harris) | Who pays tail when I leave, for any reason? | About $3,676 at 200% of $1,838 |
| PTO and holidays | Daily rate = salary ÷ 260 | How many paid days, and do they roll over? | $576.92 a day at $150,000 |
| CE money and days | Dollars plus paid days off | Does unused CE money roll over? | About $1,500 a year |
| Licenses, DEA, certification | Fees you would pay yourself | Do you reimburse every license, DEA registration and certification renewal you require? | DEA $888 per 3-year registration, per state; AANPCB renewal $195 non-member, $120 member |
| Collaborative agreement | Fees you would pay a collaborating physician | Does the employer arrange and pay for it? | Applies in the 12 reduced and 11 restricted states |
| Paid admin and inbox time | Hours per week × your hourly rate × working weeks | How many paid non-patient hours are on my template? | See below |
| Loan repayment | Award ÷ years of service required | Is the site NHSC-approved? Is the award taxable? | Confirm with the program and a CPA |
| Equipment and technology | Laptop, phone, internet, stethoscope, home-office setup | Is there a stipend for telehealth or field work? | About $1,500 a year |
| Parental leave | Paid weeks × weekly pay | How many weeks at full pay? |  |

### Hidden costs that shrink a salary

Unpaid inbox and charting time is the biggest leak in primary care and specialty clinic jobs. Five unpaid hours a week over 46 working weeks is 230 hours a year.

At $150,000, your hourly equivalent is $72.12 ($150,000 ÷ 2,080). Those 230 hours are worth $16,588 of unpaid work.

- Ask for documentation and inbox time built into the template, such as one paid admin hour per clinic day.
- Ask how many patient messages, refill requests, lab results and prior authorizations each NP handles per day.
- In urgent care and hospital roles, ask whether you are paid for charting after the shift ends and for handoff time.

### The total compensation formula

**Total compensation = Base + Expected bonus + (Sign-on bonus ÷ Years committed) + Employer-paid benefits + Employer-paid costs**

PTO is already inside the salary, so do not add it again. Use the $576.92 daily rate only to compare offers with different PTO or to price a trade, such as 5 extra days for $2,885 less salary.

### Items NPs often forget to price

- **A collaborative agreement.** In reduced and restricted practice states, ask who pays the collaborating physician and what happens if that physician leaves.
- **DEA registrations in more than one state.** Each state where you prescribe controlled substances needs its own $888 registration. A primary care or urgent care telehealth role that prescribes no controlled substances may not need one; confirm before you pay.
- **State controlled-substance registrations (CSRs).** Some states, such as Illinois, Massachusetts, Michigan, Missouri and New Jersey, require one before DEA. Check your state.
- **MATE Act training.** You attest once to 8 hours of OUD/SUD training at your first new DEA registration or renewal. Ask the employer to pay for the course if you still need it.
- **Tail on a claims-made policy.** A family NP who leaves after 3 years may face a tail bill of 150 to 250% of one year's premium.
- **Procedure training.** Ask the employer to pay for training in procedures within your scope, such as skin biopsy or joint injection, because they raise your production.
`,
        bridge: 'That is the close of Chapter 1 and all of Chapter 2 of 8. The full guide adds market anchors for each NP specialty, the five pay models decoded, the 1099 vs. W-2 calculator, an offer comparison worksheet, negotiation scripts word for word, the 20-point contract red-flag audit and how to renegotiate after year one.',
    },
    disclaimer: 'This guide is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        { title: 'About This Guide', page: 1, sections: [] },
        {
            chapter: 1,
            title: 'Know Your Number: Market Anchors for Every NP Specialty',
            page: 2,
            sections: [
                'The national pay distribution',
                'State medians',
                'Specialty data',
                'Live posting ranges, October 2026',
                'Your leverage in 2026',
                'Set your three numbers',
            ],
        },
        {
            chapter: 2,
            title: 'Total Compensation, Not Salary',
            page: 7,
            inExcerpt: true,
            sections: ['What each item is worth', 'Hidden costs that shrink a salary', 'The total compensation formula', 'Items NPs often forget to price'],
        },
        {
            chapter: 3,
            title: 'Pay Models Decoded',
            page: 10,
            sections: ['The five models at a glance', 'Salary and hourly', 'wRVU production pay', 'Collections percentage', 'Per-visit 1099 pay'],
        },
        {
            chapter: 4,
            title: 'The 1099 vs. W-2 Calculator',
            page: 13,
            sections: [
                'The formula',
                'Worked example: replacing a $150,000 W-2 job',
                'Break-even rates at other salaries',
                'The 1.5x rule of thumb',
                'Turning a 1099 offer into a W-2 salary',
                'Using the break-even in a negotiation',
                'Self-employment taxes',
                'Your worksheet',
            ],
        },
        {
            chapter: 5,
            title: 'The Offer Comparison Worksheet',
            page: 17,
            sections: [
                'The effective hourly formula',
                'Worked example: three hypothetical FNP offers',
                'What the example teaches',
                'Your blank worksheet',
                'Factors the math does not capture',
            ],
        },
        {
            chapter: 6,
            title: 'Negotiation Scripts, Word for Word',
            page: 21,
            sections: [
                'Seven rules before you speak',
                'Pick your anchor',
                'Script 1: The counteroffer email',
                'Script 2: The phone negotiation',
                'Script 3: The silence rule',
                'Script 4: When they say "This is our standard contract"',
                'Script 5: The sign-on and retention bonus ask',
                'Script 6: The remote work and schedule ask',
                'Script 7: Asking for tail coverage',
                'Script 8: Declining gracefully',
                'Script 9: Accepting in writing',
            ],
        },
        {
            chapter: 7,
            title: 'The 20-Point Contract Red-Flag Audit',
            page: 28,
            sections: ['How to run the audit', 'The 20 checks', 'Extra checks for telehealth roles', 'Your audit log', 'Non-compete law in 2026'],
        },
        {
            chapter: 8,
            title: 'Renegotiating After Year One',
            page: 32,
            sections: [
                'The data to bring',
                'Turn your production into a number',
                'The 90-day timeline',
                'Script 10a: The meeting request',
                'Script 10b: The renegotiation conversation',
                'Script 10c: When the answer is no or not yet',
                'Ask for more than base pay',
                'If you plan to leave',
            ],
        },
        { title: 'Sources and Update Log', page: 36, sections: [] },
    ],
    keyFigures: [
        {
            title: 'The package around the salary',
            figure: '$34,883 a year',
            text: 'What benefits and employer-paid costs add to a $150,000 W-2 salary: health insurance, the retirement match, payroll tax, CE, equipment, licenses, and malpractice with its tail. Replacing all of it as a 1099 contractor costs $184,883.',
            source: 'Chapters 2 and 4, October 2026',
        },
        {
            title: 'Unpaid charting time',
            figure: '$16,588',
            text: 'Five hours a week of unpaid inbox and charting work over 46 working weeks, valued at the $72.12 hourly equivalent of a $150,000 salary.',
            source: 'Chapter 2',
        },
        {
            title: 'Five pay models',
            text: 'The same pay can arrive five ways, and each one moves risk between you and the employer. Convert every offer to one model before you compare.',
            table: {
                columns: ['Model', 'Paid by', 'Risk sits with'],
                rows: [
                    ['W-2 salary', 'A fixed yearly amount, often with a bonus', 'The employer'],
                    ['W-2 hourly or shift', 'The hour or the shift', 'The employer, when shifts are guaranteed'],
                    ['Per visit', 'A flat fee for each visit', 'You, for slow hours and no-shows'],
                    ['wRVU production', 'A rate for each work RVU', 'Shared, with volume risk on you'],
                    ['Collections percentage', 'A share of what is collected under your NPI', 'You, for payer and denial risk'],
                ],
            },
            source: 'Chapter 3',
        },
        {
            title: 'W-2 to 1099 break-even',
            figure: '$108.75 an hour',
            text: 'The 1099 rate per billable hour that matches a $150,000 W-2 job with benefits, at 1,700 billable hours: about 1.5 times its $72.12 hourly equivalent. Test an offer in the 1099 vs W-2 calculator.',
            link: { phrase: '1099 vs W-2 calculator', href: '/tools/1099-vs-w2-calculator' },
            source: 'Chapter 4, October 2026',
        },
        {
            title: 'Tail coverage',
            figure: 'About $3,676',
            text: 'A tail bill at 200% of a $1,838 claims-made premium, the CM&F average for a full-time family or urgent care NP at $1M/$3M limits. Brokers put tail at 150% to 350% of a year\'s premium, so settle who pays it before you sign. Our guide to NP malpractice insurance explains claims-made coverage.',
            link: { phrase: 'NP malpractice insurance', href: '/blog/np-malpractice-insurance-guide' },
            source: 'CM&F, Leavitt and Griffith E. Harris, as cited in Chapter 2',
        },
    ],
    faqHeading: 'Common questions about NP contract negotiation',
    faq: [
        {
            question: 'How do you negotiate a nurse practitioner contract?',
            answer: 'Set three numbers before the first call: a walk-away, a target your data supports and an ask at the top of a range you can defend. Then price the whole package, run every draft through a red-flag audit and send all your requested changes in one message. The guide adds word-for-word scripts, and the blog covers NP salary negotiation tactics.',
            link: { phrase: 'NP salary negotiation', href: '/blog/np-salary-negotiation-guide' },
        },
        {
            question: 'What are red flags in an NP contract?',
            answer: 'Chapter 7 runs 20 checks on every draft. The three it calls the costliest are a claims-made malpractice policy with no tail, a broad non-compete and pay that the employer may change without your agreement. Others include a notice period that is brief or binds only you, a vague definition of cause, a sign-on bonus repaid in full after an early exit, an undefined bonus formula, no limit on daily patient volume, and licenses and DEA left for you to pay.',
        },
        {
            question: 'Should a lawyer review an NP contract?',
            answer: 'Yes. The guide treats its audit as the check you run first, so you know what to ask for, and gives the last read of the final draft to a healthcare attorney licensed where you practice. Check that each change you won is written into the signed contract itself, because an email is not enough.',
        },
        {
            question: 'What is an NP benefits package worth?',
            answer: 'Around a $150,000 W-2 salary, about $34,883 a year. The guide prices each item: about $9,000 a year for individual health insurance, $6,000 for a 4% retirement match, about $1,500 for disability and life insurance, $1,838 for malpractice, and CE and equipment at about $1,500 each. Unpaid charting time works the other way, costing $16,588 a year at five hours a week.',
        },
        {
            question: 'Who pays for tail coverage if you leave?',
            answer: 'Whoever the contract says, which is why to ask before you sign. With claims-made coverage, a tail usually runs 150% to 250% of a year\'s premium (Leavitt), and some brokers quote up to 350%. At 200% of the $1,838 average premium, that is about $3,676. An employer-paid tail or an occurrence policy removes the bill.',
        },
        {
            question: 'Is a 1099 NP contract worth more than a W-2 job?',
            answer: 'Only if the rate clears your break-even. A 1099 rate has to be roughly 1.5 times the W-2 hourly figure, because you pay your own benefits, payroll tax, malpractice and licenses: to replace a $150,000 W-2 job, about $108.75 per billable hour at 1,700 hours a year. The 1099 vs W-2 comparison covers the tax side.',
            link: { phrase: '1099 vs W-2 comparison', href: '/resources/1099-vs-w2' },
        },
    ],
};

import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/first-year-playbook, aimed at the collaborative
 * agreement searches a new NP makes; the board exam comparison belongs to
 * the blog's exam posts, and the first job search to the new grad post.
 * Every figure restates the First-Year NP Playbook (rules checked October
 * 2026; BLS figures May 2025; exam fees and 2025 pass rates as the
 * certifying bodies published them).
 *
 * The excerpt quotes printed pages 15 to 18 as the PDF prints them: the
 * green and red flags from Chapter 4's job search advice, then all of
 * Chapter 5. The only change is the ** around the run-in leads the PDF sets
 * in bold. Practice authority counts are held to lib/state-practice-authority.ts
 * by tests/app/guide-preview-page.test.ts.
 */
export const FIRST_YEAR_PLAYBOOK_PREVIEW: GuidePreview = {
    noun: 'playbook',
    seo: {
        title: 'Collaborative Agreement for Nurse Practitioners',
        description: 'Where a new NP needs a collaborative agreement, how to find a collaborator, what to pay and the 21 terms to check, from the First-Year NP Playbook.',
    },
    h1: 'Collaborative Agreements for Nurse Practitioners, from the First-Year NP Playbook',
    intro: 'If your first NP job is in one of the 23 states AANP classifies as reduced or restricted practice, a collaborative, supervisory or similar agreement shapes your daily work, and several full-practice states require one during a transition period. Chapter 5 of the First-Year NP Playbook, below, shows where you will need one, how to find a collaborator, what to pay and every term to check.',
    edition: { name: 'October 2026', updated: '2026-10-24' },
    contentDate: '2026-11-27',
    excerpt: {
        heading: 'Read Chapter 5: Collaborative Agreements',
        note: 'Printed pages 15 to 18 of the playbook: the green and red flags from Chapter 4, then all of Chapter 5, from where you will need an agreement to the full terms checklist.',
        pages: [15, 16, 17, 18],
        body: `
### Green flags

- A written orientation of several weeks, with a ramp-up schedule that starts you below a full schedule
- A formal NP fellowship or residency, especially in acute care, urgent care or primary care
- A named physician or senior NP for same-day questions, on every shift
- New-patient visits of 30 to 60 minutes and follow-ups of at least 15 to 20 minutes, with paid charting time
- Protected inbox time built into your schedule
- A collaborator or supervising physician provided at no cost to you, where your state requires one
- Employer-paid malpractice with tail coverage or an occurrence policy
- Employer-paid licenses, DEA registration, CE and board certification fees
- Procedure training and credentialing included, for roles that expect procedures
- An NHSC-approved site, or another loan repayment or tuition benefit

### Red flags

- "You will be on your own" or no physician or senior NP reachable during your shift
- A full schedule in week one, or 10-minute visits for new patients
- Solo urgent care or emergency shifts for a new graduate with no on-site backup
- Pay tied only to productivity (RVUs or visits) from day one, with no salary guarantee during ramp-up
- You pay your own collaborator out of your salary, or the fee is a percentage of revenue
- A 1099 contract with no supervision for your first job
- A claims-made malpractice policy with no tail coverage
- A non-compete with a large radius or a multi-year term
- Procedures expected without training or credentialing

Any two red flags together are a reason to keep looking. A first job should build your skills and your hour log, not just your paycheck.

## Chapter 5: Collaborative Agreements

23 states (12 reduced and 11 restricted) require a collaborative, supervisory or similar agreement for NPs to practice or prescribe, and several full-practice states require one during a transition period. If your first job is in one of those states, the agreement shapes your daily work, so read every term.

### Where you will need one

| Situation | States | What it is called or requires |
| Reduced practice | AL, AR, IL, IN, KY, LA, MS, NJ, OH, PA, WV, WI | A collaborative agreement or protocol for at least one element of practice, often prescribing |
| Restricted practice | CA, FL, GA, MI, MO, NC, OK, SC, TN, TX, VA | Supervision, delegation or team management by a physician |
| California | CA | Standardized procedures and a supervising physician for furnishing, until you qualify as a 103 NP |
| New Jersey | NJ | A joint protocol until you pass 5,000 hours in an eligible population (family, adult-gerontology, pediatrics, women's health or behavioral health) |
| New York | NY | A written practice agreement until you pass 3,600 hours |
| Connecticut | CT | Collaboration with a physician for 3 years and 2,000 hours |
| Oklahoma | OK | Supervised prescribing until 6,240 hours; Schedule II still excluded after that |

Terms such as chart review rates, meeting frequency and how many NPs one physician may collaborate with differ by state. Read your board's rules and any required agreement form before you sign.

### Where to find a collaborator

1. **Your employer.** Most W-2 employers in reduced and restricted states assign a collaborating physician. Ask for this in writing before you accept.

2. **Physicians you trained with.** Preceptors and faculty know your work and may agree to collaborate.

3. **Professional networks.** State NP associations and specialty groups often connect members with collaborators.

4. **Paid collaborator-matching services.** These exist, but vet them closely: confirm the physician's license, specialty, board standing and malpractice before you sign.

Choose a collaborator in your own field where you can: a family or internal medicine physician for primary care, an emergency physician for urgent care, a pediatrician for pediatrics, an OB-GYN for women's health. A physician outside your field may meet the legal rule but give you less useful clinical backup.

### What it costs

When your employer provides the collaborator, you should pay nothing. If you must pay, get at least three written quotes and compare the services each one includes.

- **Pay a flat, fair-market-value fee** for the time and services actually provided.
- **Never pay a percentage of your revenue or collections.** Percentage fees can raise fee-splitting and anti-kickback concerns.
- **Never accept referrals as part of the payment.** Keep the agreement about supervision and consultation only.

Fair-market value depends on the physician's time and your state's requirements. Ask a healthcare attorney to review the fee before you sign.

### Full terms checklist

- Parties named, with both license numbers and states
- Your population focus and practice settings described
- Prescriptive authority defined, including which schedules you may prescribe
- Any limits on Schedule II and how those prescriptions are handled
- Procedures you may perform, and how competence is documented
- Chart review method, percentage and frequency
- Meeting frequency and format (in person, video, phone)
- How fast the collaborator answers urgent consults, and by what channel
- A named backup collaborator for vacations and absences
- Emergency, transfer and hospitalization procedures
- Malpractice: each party's own coverage, limits and whether either must be named
- Fee, if any: a flat amount, payment schedule and what it covers
- Term, renewal date and annual review
- Termination: 60 to 90 days' written notice by either side
- Plan for patient continuity if the agreement ends
- Where the agreement is filed with the board, if filing is required
- Required state-specific elements included, checked against the board's rules
- Records retention and access to charts after termination
- No non-compete and no referral obligations
- Mutual indemnification limited to each party's own negligence
- Signatures and dates from both parties, with a copy in your files

This chapter is educational and is not legal advice. Have a licensed healthcare attorney review any collaborative agreement before you sign it.
`,
        bridge: "That is Chapter 4's green and red flags and all of Chapter 5 of 9. The full playbook covers the rest of year one: licensing in the right order, choosing and passing your board exam, transition hours, your first 90 days clinically, your CE plan, first-year pay and a month-by-month checklist.",
    },
    disclaimer: 'This playbook is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        { title: 'About This Playbook', page: 1, sections: [] },
        {
            chapter: 1,
            title: 'Graduation to License in the Right Order',
            page: 2,
            sections: ['The order of operations', 'Month-by-month timeline'],
        },
        {
            chapter: 2,
            title: 'Choosing and Passing Your Board Exam',
            page: 4,
            sections: ['Every NP population exam at a glance', 'How to choose between two exams in your population', 'An 8- to 12-week study plan', 'If you do not pass'],
        },
        {
            chapter: 3,
            title: 'Practice Authority, Transition Hours and a Five-Year Plan',
            page: 8,
            sections: [
                'Practice authority by state (AANP classification, May 2026 map)',
                'Transition-to-practice (TTP) hours',
                'Keep a signed hour log from day one',
                'A five-year plan',
            ],
        },
        {
            chapter: 4,
            title: 'Green Flags and Red Flags in Your First Job Search',
            page: 12,
            sections: [
                'The market in numbers',
                'Where new graduates get hired, by specialty',
                'NHSC Loan Repayment Program (2026 cycle)',
                'Green flags',
                'Red flags',
                'How to search',
            ],
        },
        {
            chapter: 5,
            title: 'Collaborative Agreements',
            page: 16,
            inExcerpt: true,
            sections: ['Where you will need one', 'Where to find a collaborator', 'What it costs', 'Full terms checklist'],
        },
        {
            chapter: 6,
            title: 'Your First 90 Days Clinically',
            page: 18,
            sections: [
                'A 90-day ramp',
                'Order sets',
                'Smart phrases',
                'Referral and prior authorization workflow',
                'Protect 20 minutes a day for your inbox',
                'When to consult',
                'Weekly case review',
            ],
        },
        {
            chapter: 7,
            title: 'Your Credential Stack and CE Plan',
            page: 23,
            sections: ['Credential tracker', 'Your CE plan: 15 to 20 hours a year, including 5 in pharmacology', 'Where year-one CE comes from', 'CE log'],
        },
        {
            chapter: 8,
            title: 'Your First-Year Pay and What New Grads Earn',
            page: 26,
            sections: [
                'The national pay curve for NPs (BLS, May 2025)',
                'Specialty changes the number',
                'Location changes the number',
                'How to judge a first offer',
                'What to ask for besides base pay',
            ],
        },
        {
            chapter: 9,
            title: 'The Year-One Checklist',
            page: 29,
            sections: ['Before your first day', 'First 30 days', 'Days 31 to 90', 'Months 4 to 9', 'Months 10 to 12'],
        },
        { title: 'Sources and Update Log', page: 31, sections: [] },
    ],
    keyFigures: [
        {
            title: 'Graduation to first prescription',
            figure: '3 to 6 months',
            text: 'The span to plan for between graduating and writing your first prescription, because each step waits on the one before: a single missing transcript can hold up all the rest. Certifying bodies give you 90 to 180 days to sit the exam once approved.',
            source: 'Chapter 1, rules checked October 2026',
        },
        {
            title: 'Two family NP board exams',
            text: 'Both certify family NPs, and either works where your board and employer accept it. Our AANP vs ANCC comparison covers how to choose.',
            table: {
                columns: ['Exam', 'Format', 'Fee', 'First-time pass, 2025'],
                rows: [
                    ['FNP-C (AANPCB)', '150 in 3 hours', '$315; $240 for AANP members', '81%'],
                    ['FNP-BC (ANCC)', '175, 150 of them scored, in 3.5 hours', '$395 for non-members', '82%'],
                ],
            },
            link: { phrase: 'AANP vs ANCC comparison', href: '/blog/fnp-certification-aanp-vs-ancc' },
            source: 'Chapter 2: AANPCB and ANCC fees and 2025 pass rates, checked October 2026',
        },
        {
            title: 'What new grads earn',
            figure: '$101,340 to $117,990',
            text: 'Where a new-graduate primary care NP usually starts in a state with typical living costs, under the $132,300 national median. A specialty, a setting or a state can shift that by $30,000 or more.',
            source: 'Chapter 8, on BLS OEWS, May 2025',
        },
        {
            title: 'DEA registration',
            figure: '$888',
            text: 'The fee for a 3-year registration, which covers one state and one practice address. Hold off until you have an offer in writing and know where you will practice, then ask the employer to cover it.',
            source: 'Chapter 1, DEA fee as of October 2026',
        },
        {
            title: 'Continuing education in year one',
            figure: '15 to 20 hours',
            text: 'A year of CE to plan for, with 5 of those hours in pharmacology, logged as you go so renewal is a matter of uploading certificates.',
            source: 'Chapter 7',
        },
    ],
    faqHeading: 'Common questions about collaborative agreements and the first NP year',
    faq: [
        {
            question: 'Do new nurse practitioners need a collaborative agreement?',
            answer: 'It depends on your state. AANP classifies 12 states as reduced and 11 as restricted practice, and in those 23 an NP needs a collaborative, supervisory or similar agreement for at least one part of practice, often prescribing. Several full-practice states add a transition period first: New York until 3,600 hours, Connecticut for 3 years and 2,000 hours. Check your state on the scope of practice explorer.',
            link: { phrase: 'scope of practice explorer', href: '/scope-of-practice' },
        },
        {
            question: 'How do you find a collaborating physician?',
            answer: 'Start with your employer: most W-2 employers in reduced and restricted states assign one, and you should get that in writing before you accept. After that, physicians you trained with, state NP associations and specialty groups, and paid matching services, which you should vet for license, specialty, board standing and malpractice. A collaborator in your own field gives you more useful clinical backup.',
        },
        {
            question: 'How much does a collaborating physician cost?',
            answer: 'When your employer provides the collaborator, you should pay nothing. If you pay one yourself, the playbook names no standard fee: it should be a flat, fair-market-value amount for the time and services provided, compared across at least three written quotes. Never agree to a percentage of your revenue or collections, or to referrals as payment.',
        },
        {
            question: 'What should a collaborative agreement include?',
            answer: 'The checklist in Chapter 5 runs to 21 terms. Among them: which schedules you may prescribe, how charts are reviewed and how often, how fast urgent consults are answered, a named backup collaborator, each party\'s malpractice, the fee, a 60 to 90 day notice period for either side, and no non-compete or referral obligations. Have a licensed healthcare attorney review it before you sign.',
        },
        {
            question: 'What are red flags in a first NP job?',
            answer: 'Among them: no physician or senior NP you can reach during a shift, a full schedule in week one, solo urgent care shifts for a new graduate, pay tied only to productivity from day one, paying your own collaborator, and a claims-made malpractice policy with no tail. The playbook treats any two together as a reason to keep looking. For the search itself, see how to land your first NP job.',
            link: { phrase: 'how to land your first NP job', href: '/blog/new-grad-np-first-job' },
        },
        {
            question: 'Which NP board exam should you take?',
            answer: 'Choose by population focus first, then by what your state board and any employer name, and by how you test. For family NPs, AANPCB\'s FNP-C is 150 questions in 3 hours ($315, or $240 for AANP members) and ANCC\'s FNP-BC is 175 questions in 3.5 hours ($395 for non-members). First-time pass rates in 2025 were 81% and 82%. Chapter 2 compares every population\'s exams.',
        },
    ],
};

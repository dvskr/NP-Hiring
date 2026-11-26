import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/telehealth-playbook, aimed at licensing across
 * state lines; the telehealth jobs pages keep the job searches. Every figure
 * restates The Telehealth NP Playbook as of October 2026 (the NLC list, the
 * APRN Compact count and AANP's May 2026 practice authority map).
 *
 * The excerpt quotes printed pages 5 to 8 and 11 as the PDF prints them:
 * all of Chapter 2 and Chapter 3's "Service-line fit". The changes: the
 * chapter opener's "no shortcut" sentence is left out, because some states
 * offer out-of-state telehealth registrations the sentence does not allow
 * for; the last row of the population table, which points to another
 * edition of the playbook, is left out; and ** marks the run-in leads the
 * PDF sets in bold. Nothing on the page states a dated controlled-substance
 * rule: the catalog summary names one, so this page carries its own, and
 * the contents name Chapter 7 by its title only.
 */
export const TELEHEALTH_PLAYBOOK_PREVIEW: GuidePreview = {
    noun: 'playbook',
    seo: {
        title: 'How to Get an NP License in Multiple States',
        description: 'The NLC covers RN licenses only, and the APRN Compact is not live yet. How NPs license state by state for telehealth, from our Telehealth NP Playbook.',
    },
    h1: 'How to Get an NP License in Multiple States: The Telehealth NP Playbook',
    intro: "For a telehealth visit, the patient's physical location decides which state's law applies, so plan on an RN license or NLC privilege and an APRN license in your population focus for each state where your patients sit. The NLC covers only the RN license, and the APRN Compact is enacted in 4 of the 7 states it needs, so a multistate APRN license does not exist yet.",
    edition: { name: 'October 2026', updated: '2026-10-24' },
    summary: 'How to license across states, decide whether you need DEA, plan controlled-substance prescribing by telehealth, bill correctly, judge a platform job and price your time.',
    contentDate: '2026-11-27',
    excerpt: {
        heading: 'Read Chapter 2: Licensing Across State Lines',
        note: "Printed pages 5 to 8 and 11 of the playbook: the patient-location rule, the RN and APRN layers, the NLC's October 2026 status, the APRN Compact, and what telehealth platforms look for in your first states.",
        pages: [5, 6, 7, 8, 11],
        body: `
## Chapter 2: Licensing Across State Lines

Every state where your patients sit needs two credentials from you: an RN license (or NLC privilege) and an APRN license in your population focus.

### The patient-location rule

The patient's physical location at the time of the visit decides which state's law applies. A Texas resident on a work trip in Colorado is, for that visit, a Colorado patient. If you are not licensed in Colorado, reschedule the visit. Confirm and document the patient's location at the start of every session, including asynchronous visits.

### Layer 1: your RN license

The Nurse Licensure Compact (NLC) lets an RN with a multistate license practice in other compact states. If your primary state of residence is an NLC state, your multistate RN license usually satisfies the RN requirement in the other NLC states.

| NLC status (October 2026) | States |
| Fully implemented (40) | Alabama, Arizona, Arkansas, Colorado, Connecticut, Delaware, Florida, Georgia, Idaho, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Mississippi, Missouri, Montana, Nebraska, New Hampshire, New Jersey, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming |
| Enacted, partial or awaiting implementation | Guam, Massachusetts, U.S. Virgin Islands |
| Not in the NLC | Alaska, California, District of Columbia, Hawaii, Illinois, Michigan, Minnesota, Nevada, New York, Oregon |

In a non-NLC state you need a separate RN license by endorsement in addition to the APRN license.

### Layer 2: your APRN license

The NLC does not cover APRNs. Its own FAQ says an APRN must hold an individual APRN license in each state of practice. That APRN license grants your title, scope and prescriptive authority.

### Your population focus travels with you

Telehealth does not widen your scope. Each state licenses you in the population focus of your national certification, and you must stay inside it on every visit.

| Certification | Typical telehealth fit | Scope cautions |
| FNP | Urgent care, primary care, chronic care, men's and women's health, weight management | All ages, but some platforms limit pediatric ages or require in-person exams for infants |
| AGPCNP | Adult primary care, chronic care, Medicare wellness visits, remote monitoring | No patients under adolescence; follow your board's age definition |
| AGACNP | Hospital tele-rounding, tele-ICU, post-discharge follow-up | Acute and critical care focus; ongoing primary care panels may fall outside scope in some states |
| PNP (primary care or acute care) | Pediatric urgent care, school-based telehealth, behavioral support | Children and young adults only, as your board defines the range |
| WHNP | Contraception, menopause, sexual health, prenatal follow-up | Women's and gender-related health; general adult complaints may fall outside scope |
| ENP | Video urgent care and triage | Some boards do not license ENP as a separate population; confirm how your state recognizes it |

Age cut-offs and how each population is defined vary by state. Confirm them with each board before you accept a platform's patient queue.

### The APRN Compact: enacted, but not live

The APRN Compact would create a true multistate APRN license, but it activates only after seven states enact it.

**Enacted:** North Dakota (2021), Delaware (2021), Utah (2022) and South Dakota (2024). That is 4 of the 7 states needed.

**Counting disputes:** some 2026 websites count Wyoming as a fifth state. Wyoming passed an earlier version of the compact, which does not count toward the revised one. The official NCSBN count is 4.

**Pending bills:** New York's S3916 has been in committee since January 7, 2026. 2025 bills in Arizona, Arkansas, Kansas and Montana died or were withdrawn. Check NCSBN's news releases and your board of nursing for new enactments.

**What it will do once live:**

- Require at least 2,080 hours of APRN practice to qualify for a multistate license.
- Allow independent practice in other compact states with no supervisory or collaborative agreement.
- Cover prescribing of non-controlled drugs only. Controlled-substance authority will still follow each state's rules and your per-state DEA registration.

**Bottom line for all NPs:** the compact would help most with non-controlled primary and urgent care. Testosterone, phentermine, ADHD and pain prescribing will still need state-by-state authority and DEA registration, so plan your state list on individual licenses.

### Service-line fit: what platforms look for

Platforms hire by state, and the states they want depend on what they sell. Match your first states to the work you want.

**Video and asynchronous urgent care** prizes high-population full-practice states, because one license opens a large patient pool with no collaborator. The largest full-practice states by population include New York, Washington, Arizona, Massachusetts, Maryland, Colorado and Minnesota. New York requires 3,600 hours first.

**Chronic care, remote monitoring and wellness visits** prize states with strong Medicare Advantage enrollment, because those plans pay for care management at scale. Nationally, 54% of eligible Medicare beneficiaries were in Medicare Advantage in 2025 (KFF, via Becker's). Look up each state's current share in KFF's State Health Facts before you score it.

**Large restricted states** such as California, Texas and Florida still have high demand. Platforms there must supply a supervising or collaborating physician, so ask who provides it and who pays.

**Pediatric and women's health platforms** often hire in fewer states. Ask a recruiter which states have the longest patient wait lists.
`,
        bridge: 'That is Chapter 2 and part of Chapter 3 of 13. The full playbook adds a worksheet that scores candidate states, the cost and timing of each new license, prescriptive authority and DEA strategy, telehealth billing, platform pay models and due diligence, a 1099 rate calculator, compliance setup, contract red flags and templates.',
    },
    disclaimer: 'This playbook is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        { title: 'About This Playbook', page: 1, sections: [] },
        { chapter: 1, title: 'The 2026 to 2027 Telehealth Rulebook in One Page', page: 2, sections: [] },
        {
            chapter: 2,
            title: 'Licensing Across State Lines',
            page: 5,
            inExcerpt: true,
            sections: [
                'The patient-location rule',
                'Layer 1: your RN license',
                'Layer 2: your APRN license',
                'Your population focus travels with you',
                'The APRN Compact: enacted, but not live',
            ],
        },
        {
            chapter: 3,
            title: 'Choosing Your First Three States',
            page: 8,
            sections: [
                'Practice authority by state (AANP classification, May 2026 map)',
                'Transition-to-practice hours that may apply to you',
                'Service-line fit: what platforms look for',
                'The scoring worksheet',
            ],
        },
        {
            chapter: 4,
            title: 'Adding a State License, Step by Step',
            page: 13,
            sections: ['What it costs and how long it takes', 'Tips that save weeks'],
        },
        {
            chapter: 5,
            title: 'Prescriptive Authority, Furnishing Numbers and State Registrations',
            page: 15,
            sections: [
                'Prescriptive authority',
                'State controlled-substance registrations',
                'California: furnishing numbers and the 103/104 pathway (AB 890)',
                'New York and New Jersey',
                'Your prescriptive-authority checklist for each new state',
            ],
        },
        {
            chapter: 6,
            title: 'DEA Registration Strategy for Multistate Practice',
            page: 17,
            sections: ['The rules', 'Do you need DEA in this state?', 'Five-state cost example', 'Strategy'],
        },
        { chapter: 7, title: 'Controlled-Substance Telehealth Now and on January 1, 2027', page: 19, sections: [] },
        {
            chapter: 8,
            title: 'Medicare, Medicaid and Commercial Telehealth Billing',
            page: 24,
            sections: ['Medicare in 2026', 'The codes telehealth NPs bill most', 'Medicaid', 'Commercial payers'],
        },
        {
            chapter: 9,
            title: 'Telehealth Platforms, Pay Models and Due Diligence',
            page: 27,
            sections: ['The pay models you will see', 'Fifteen questions to ask any platform before you sign', 'Warning signs at a platform'],
        },
        {
            chapter: 10,
            title: 'The 1099 vs. W-2 Rate Calculator',
            page: 30,
            sections: [
                'The formula',
                'Worked example: replacing a $150,000 W-2 job',
                'Break-even rates at other salaries',
                'Converting to a per-visit rate',
                'Self-employment tax essentials',
                'Your worksheet',
            ],
        },
        {
            chapter: 11,
            title: 'Compliance Setup for Telehealth Practice',
            page: 33,
            sections: [
                'Your space and technology',
                'Identity and location verification',
                'Physical exam limits',
                'In-person and emergency referral thresholds',
                'Antibiotic stewardship and documentation',
            ],
        },
        { chapter: 12, title: 'Contract Red Flags for Telehealth Roles', page: 36, sections: ['Non-compete law in 2026'] },
        {
            chapter: 13,
            title: 'Checklists and Templates',
            page: 39,
            sections: ['Multistate license tracker', 'New-state onboarding checklist', 'Platform offer checklist', 'Telehealth visit note template'],
        },
        { title: 'Sources and Update Log', page: 42, sections: [] },
    ],
    keyFigures: [
        {
            title: 'NLC status, October 2026',
            figure: '40 states',
            text: 'The number that have fully put the Nurse Licensure Compact in place. California, New York, Illinois and seven other jurisdictions are not in it, and the compact never covers the APRN license itself.',
            source: 'Chapter 2, NLC status as of October 2026',
        },
        {
            title: 'APRN Compact',
            figure: '4 of 7',
            text: 'The states needed that have enacted the APRN Compact: North Dakota, Delaware, Utah and South Dakota, by the official NCSBN count. Until three more join, every state still takes its own APRN license. Track it on our APRN Compact states page.',
            link: { phrase: 'APRN Compact states', href: '/blog/aprn-compact-states' },
            source: 'NCSBN, as cited in Chapter 2 (October 2026)',
        },
        {
            title: 'Adding one state',
            figure: '6 to 12 weeks',
            text: 'From a complete application to a license you can practice on, for a few hundred dollars in fees. DEA adds $888 per state for 3 years, needed only where your work includes controlled substances.',
            source: 'Chapter 4, typical figures as of October 2026',
        },
        {
            title: 'Practice authority by state',
            figure: '27 states and DC',
            text: "Full practice in AANP's May 2026 map, with 12 states reduced and 11 restricted. Full-practice states with large populations open the biggest patient pools without a collaborator. Look up any state in the scope of practice explorer.",
            link: { phrase: 'scope of practice explorer', href: '/scope-of-practice' },
            source: 'AANP classification, May 2026 map (Chapter 3)',
        },
        {
            title: 'Medicare Advantage',
            figure: '54%',
            text: 'The share of eligible Medicare beneficiaries in Medicare Advantage in 2025, which is why chronic care and remote monitoring platforms favor states where those plans are strong.',
            source: "KFF, via Becker's, as cited in Chapter 3",
        },
    ],
    faqHeading: 'Common questions about NP licensing across state lines',
    faq: [
        {
            question: 'Can a nurse practitioner be licensed in multiple states?',
            answer: 'Yes, one state at a time. The patient\'s location during the visit decides which state\'s law applies, so you hold an individual APRN license in each state where your patients sit, plus an RN license there or an NLC multistate privilege. Confirm and document the patient\'s location at the start of every session, including asynchronous visits.',
        },
        {
            question: 'Can you get a multistate NP license?',
            answer: 'Not yet. The Nurse Licensure Compact covers RN licenses only. The APRN Compact would create a multistate APRN license, but it takes effect only once seven states enact it, and by NCSBN\'s count as of October 2026 four have: North Dakota, Delaware, Utah and South Dakota. Once live, it would cover non-controlled prescribing only.',
        },
        {
            question: 'Which states should a telehealth NP license in first?',
            answer: 'The playbook scores each candidate state on eight weighted factors: practice authority, the transition hours you have already completed, the fit with your service line, controlled-substance rules, how fast the board works, total cost, patient demand and payer fit. With a multistate RN license from an NLC state, the RN step costs nothing in other NLC states, so those states are quicker and cheaper to add.',
        },
        {
            question: 'How do you become a telehealth nurse practitioner?',
            answer: 'Pick the work first, because platforms hire by state for what they sell: urgent care platforms favor large full-practice states, chronic care and remote monitoring favor strong Medicare Advantage markets. License in those states, confirm every patient\'s location at each visit, and check a platform\'s pay model and terms before you sign. Browse open roles on remote and telehealth NP jobs.',
            link: { phrase: 'remote and telehealth NP jobs', href: '/jobs/remote' },
        },
        {
            question: 'Does your population focus limit telehealth work?',
            answer: 'Yes. Telehealth does not widen your scope: each state licenses you in the population focus of your national certification, and every visit must stay inside it. An AGPCNP sees no patients under adolescence, a PNP sees children and young adults, and an AGACNP\'s tele-rounding and tele-ICU work may not stretch to an ongoing primary care panel. Age cut-offs vary by state.',
        },
        {
            question: 'How long does it take to add a state license?',
            answer: 'Expect 6 to 12 weeks from a complete application to a license you can practice on, with fees of a few hundred dollars. Missing transcripts and certification verifications cause most delays, so request them the day you apply. Add DEA in a state only when your work there includes controlled substances.',
        },
    ],
};

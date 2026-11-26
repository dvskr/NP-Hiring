import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/launch-your-practice, aimed at opening an NP
 * clinic; the free private practice guide in /resources keeps the "how to
 * start an NP private practice" phrase. Every figure restates Launch Your NP
 * Practice, with prices and rules as the guide last checked them on October
 * 23, 2026 and AANP's October 2026 practice authority classification.
 *
 * The excerpt is Chapter 1 (printed pages 2 to 8) as the PDF prints it, with
 * these changes: the chapter's two opening sentences are left out, because
 * they state the full practice tier as a rule this site's practice authority
 * copy never states (tests/regressions/authority-template-truth.test.ts),
 * and the table under them carries the same counts with the transition
 * hours caveat; the transition hours lead says "Several states", because
 * its table also lists California, Oklahoma and New Jersey, which are not
 * full practice; Maine's row drops a comment deadline that has passed; the
 * Minnesota row and the last row of the scope table, which points to
 * another edition of the guide, are left out; Utah's row is set in reading
 * order; and ** marks the run-in leads the PDF sets in bold. Chapter 4's
 * dated prescribing section appears nowhere on the page.
 */
export const LAUNCH_YOUR_PRACTICE_PREVIEW: GuidePreview = {
    noun: 'guide',
    seo: {
        title: 'How to Open Your Own Clinic as a Nurse Practitioner',
        description: 'Whether your state lets an NP own a clinic, which states require transition hours and what your certification covers, from Launch Your NP Practice.',
    },
    h1: 'How to Open Your Own Clinic as a Nurse Practitioner: Launch Your NP Practice',
    intro: "Step one is confirming that you may own and run a practice in your state. As of October 2026, AANP classifies 27 states and DC as full practice and the other 23 as reduced or restricted, where a collaborative agreement, a protocol or supervision covers some or all of an NP's practice. Some states add transition hours first, and your certification limits what the clinic can offer.",
    edition: { name: 'October 2026', updated: '2026-10-24' },
    contentDate: '2026-11-27',
    excerpt: {
        heading: 'Read Chapter 1: Can You Own a Practice in Your State?',
        note: 'Printed pages 2 to 8 of the guide: practice authority by state, transition-to-practice hours, the California, New Jersey, New York and Oklahoma paths, scope by population focus and the five steps to an ownership decision.',
        pages: [2, 3, 4, 5, 6, 7, 8],
        body: `
## Chapter 1: Can You Own a Practice in Your State?

Practice authority answers one question: do you need a physician on paper? Who may own the business, and whether your niche needs a medical director, are separate questions covered in Chapter 2.

### Practice authority by state

| Category | States | What it means for a practice owner |
| Full practice (27 + DC) | AK, AZ, CO, CT, DE, DC, HI, ID, IA, KS, ME, MD, MA, MN, MT, NE, NV, NH, NM, NY, ND, OR, RI, SD, UT, VT, WA, WY | No physician agreement once you meet any transition-to-practice hours. You can launch with the fewest moving parts. |
| Reduced (12) | AL, AR, IL, IN, KY, LA, MS, NJ, OH, PA, WV, WI | A collaborative agreement or joint protocol is required for at least one part of practice, often prescribing. Budget for a collaborator before day one (Chapter 12). |
| Restricted (11) | CA, FL, GA, MI, MO, NC, OK, SC, TN, TX, VA | Supervision, delegation or team management is required. California and Oklahoma now have paths to more independence, described below. |

Indiana is still a reduced-practice state. Bills to drop its collaborative-agreement requirement died in 2025 (HB 1116) and 2026 (HB 1129), and AANP's May 2026 map lists Indiana as reduced. Some websites wrongly report that Indiana moved to full practice in 2026.

### Transition-to-practice hours

Several states make you work a set number of hours with a physician or experienced NP first. Count only hours you can prove, and keep a signed log from day one of your first job.

| State | Requirement before independent practice | Confidence |
| California | 103 NP (Business and Professions Code section 2837.103): 4,600 hours or 3 full-time years of California transition to practice within the prior 5 years. 104 NP (section 2837.104): 3 more years or 4,600 more hours as a 103 NP | Verified (CA BRN) |
| Colorado | 750 hours of mentored prescribing for full prescriptive authority | Verified |
| Connecticut | 3 years and 2,000 hours in collaboration with a physician | Verified |
| New Jersey | More than 5,000 hours to practice without a joint protocol in five population foci (2026 law) | Verified |
| New York | More than 3,600 hours to practice without a written practice agreement | Verified; provision runs through June 30, 2030 |
| Nevada | 2 years or 2,000 hours before prescribing Schedule II independently, or a physician-approved protocol | Verified (secondary source) |
| Oklahoma | 6,240 supervised prescribing hours for independent prescriptive authority; Schedule II still excluded | Verified (OK Board) |
| Delaware | No transition period: APRNs practice and prescribe independently on licensure (HB 141, 2021) | Verified (Delaware legislature) |
| Maine | 24 months with a supervising physician or supervising NP, or employment by a clinic or hospital that has a physician medical director. A 2026 law (LD 961) ends this once the Board adopts mentorship rules; the Board has proposed a 1-year clinical practice requirement | Verified (32 M.R.S. §2102; Board notice, October 7, 2026) |
| Maryland | First-time NP certificants name a mentor (an NP or physician with 3 or more years of practice) for 18 months; no hour log or written agreement | Verified (COMAR 10.27.07) |
| Massachusetts | 2 years of supervised practice before prescribing independently; equivalent experience may count | Verified (M.G.L. c.112 §80E; 244 CMR 4.07) |
| Nebraska | 2,000 hours under a transition-to-practice agreement with a physician or an NP with at least 10,000 hours | Verified (Neb. Rev. Stat. §§38-2317 and 38-2322) |
| South Dakota | 1,040 hours of licensed practice in the past 5 years; until you have them, you practice under a written collaborative agreement with a physician, CNP or CNM | Verified (SDCL 36-9A-4; ARSD 20:62:02:02) |
| Utah | No transition period: APRNs other than CRNAs may prescribe Schedule II to V controlled substances with no hours, mentor or consultation requirement | Verified (Utah Code §58-31b-803) |
| Vermont | 24 months and 2,400 hours under a formal collaborative agreement; 12 months and 1,600 hours for an added role or population focus | Verified (26 V.S.A. §1613) |

### California: the 104 NP path to a solo practice

The California Board of Registered Nursing began certifying 104 NPs in 2026. A 104 NP is the first California category that can practice without standardized procedures outside a group setting, so it is the category that allows a solo NP office without a supervising physician.

| Category | Hours required | Where you may practice |
| 103 NP | 4,600 hours or 3 full-time years of California transition to practice, within the prior 5 years | Without standardized procedures, but only in a group setting with at least one physician |
| 104 NP | 3 more years or 4,600 more hours as a 103 NP in good standing | Outside a group setting, within your certified population focus |

All hours must be completed in California. You still need a California furnishing number to prescribe.

A 104 NP also takes on duties a physician-led practice would carry. You must tell every new patient verbally that you are not a physician. You must also set up a written plan for referral of complex cases and emergencies, and consult other providers as needed.

### New Jersey: the 2026 law

New Jersey P.L.2026, c.6 was signed on March 30, 2026. APNs with more than 5,000 hours may practice without a joint protocol in five population foci when giving primary or behavioral care.

| Population focus | Covered without a joint protocol? |
| Family or individual across the lifespan | Yes, for primary care |
| Adult-gerontology | Yes, for primary care |
| Pediatrics | Yes, for primary care |
| Women's health | Yes, for primary care; general obstetrics is excluded |
| Behavioral health | Yes |
| Elective aesthetics | Excluded |

AANP still lists New Jersey as reduced. Confirm with the New Jersey Board of Nursing how it documents your hours before you drop a joint protocol.

### New York and Oklahoma

- **New York:** NPs with more than 3,600 hours may practice without a written practice agreement. You must still keep evidence of collaborative relationships with a physician or hospital. The provision runs through June 30, 2030, according to NYSED.
- **Oklahoma:** HB 2298 took effect November 1, 2025. After 6,240 supervised prescribing hours you gain independent prescriptive authority, but Schedule II drugs stay excluded. The Oklahoma Board says your scope of practice did not change.

### Scope by population focus

Your certification limits what your practice can offer, even in a full-practice state. Match the clinic you plan to the population you are certified in.

| Practice type | Usual fit | Watch for |
| Family primary care | FNP | All ages; pediatric visits need FNP or PNP |
| Adult and senior primary care | AGPCNP, FNP | No pediatric patients for AGPCNP |
| Urgent care | FNP, ENP; AGPCNP for adults only | Pediatric walk-ins; some states and payers limit urgent care to certain foci |
| Pediatric clinic | CPNP-PC, FNP | Acute-care PNPs are trained for acute settings |
| Women's health | WHNP, FNP | General obstetrics may need physician involvement |
| Aesthetics or med spa | Varies by state | Many states require a medical director or physician ownership (Chapter 2) |
| Weight management | FNP, AGPCNP | Controlled drugs such as phentermine and compounding rules (Chapter 9) |

Acute-care NPs (AGACNP) are educated for hospital and acute settings. An outpatient primary care clinic is usually outside that focus, so confirm with your board.

### Telehealth across state lines

Your practice must hold an APRN license in every state where a patient is located during the visit. The Nurse Licensure Compact covers RNs and LPNs only, never APRNs.

The APRN Compact has been enacted in 4 states (North Dakota, Delaware, Utah and South Dakota) and needs 7 to start. It is not operational, and no multistate APRN license exists.

### Your ownership decision in five steps

1. Find your practice state in the authority table.

2. Total your post-certification hours from signed logs and compare them with the transition table.

3. Confirm your clinic type fits your population focus.

4. If you fall short, choose one path: wait, launch with a collaborator (Chapter 12) or work W-2 while you finish hours.

5. Email your board of nursing to confirm your status in writing, then take the answer to a healthcare attorney before you form an entity.
`,
        bridge: 'That is Chapter 1 of 13. The full guide adds choosing your entity, the 120-day launch timeline, identifiers and credentialing, malpractice for an owner, HIPAA and compliance, EHR pricing, billing codes, cash-pay rules, a startup budget and break-even worksheet, collaborative agreements for owners and templates you can copy.',
    },
    disclaimer: 'This guide is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        { title: 'About This Guide', page: 1, sections: [] },
        {
            chapter: 1,
            title: 'Can You Own a Practice in Your State?',
            page: 2,
            inExcerpt: true,
            sections: [
                'Practice authority by state',
                'Transition-to-practice hours',
                'California: the 104 NP path to a solo practice',
                'New Jersey: the 2026 law',
                'New York and Oklahoma',
                'Scope by population focus',
                'Telehealth across state lines',
                'Your ownership decision in five steps',
            ],
        },
        {
            chapter: 2,
            title: 'Choosing Your Legal Entity',
            page: 8,
            sections: ['Entity options', 'The S-corp election', 'Corporate practice of medicine', 'Aesthetics and med spas: extra checks', 'Formation steps'],
        },
        { chapter: 3, title: 'The 120-Day Launch Timeline', page: 11, sections: [] },
        {
            chapter: 4,
            title: 'Identifiers and Registrations',
            page: 14,
            sections: [
                'The identifier stack',
                'EIN',
                'NPI Type 1 and Type 2',
                'Taxonomy codes by NP specialty',
                'CLIA: required for any in-office test',
                'State CSR and DEA: only if you need them',
            ],
        },
        {
            chapter: 5,
            title: 'Credentialing and Payer Enrollment',
            page: 19,
            sections: [
                'The order that avoids rework',
                'Medicare specifics',
                'Retro billing caution',
                'Fee schedules before signatures',
                'Credentialing checklist',
                'DIY or a credentialing service',
            ],
        },
        {
            chapter: 6,
            title: 'Malpractice Insurance for a Practice Owner',
            page: 21,
            sections: ['Claims-made vs occurrence', 'Price data (2026)', "What an owner's policy must cover", 'Questions to ask every broker'],
        },
        {
            chapter: 7,
            title: 'HIPAA and Your Compliance Program',
            page: 23,
            sections: [
                'HIPAA build list',
                'What every BAA must say',
                'Breach notification deadlines',
                'Special records',
                'The seven elements of a compliance program',
                'Fraud and abuse laws every owner must know',
            ],
        },
        {
            chapter: 8,
            title: 'Choosing an EHR',
            page: 26,
            sections: ['EHR pricing, October 2026', 'Short list by niche', 'Decision rule', 'Must-have features for an NP clinic'],
        },
        {
            chapter: 9,
            title: 'Billing and Coding Primer',
            page: 30,
            sections: [
                'Core primary care codes',
                'CCM, RPM and AWV: the Medicare primary care engine',
                'Urgent care codes and considerations',
                "Women's health codes",
                'Aesthetics and weight management',
                'The 2026 fee schedule changes',
                'Telehealth claims',
                'Documentation habits that protect you',
            ],
        },
        {
            chapter: 10,
            title: 'Cash-Pay, Insurance or Hybrid',
            page: 35,
            sections: ['Compare the models', 'Good Faith Estimates under the No Surprises Act', 'Medicare: enroll or opt out', 'Cash-pay and hybrid rules', 'Set your cash rate'],
        },
        {
            chapter: 11,
            title: 'Startup Budget and Break-Even Worksheet',
            page: 38,
            sections: ['One-time startup costs', 'Monthly fixed costs', 'Break-even formula', 'Worked example', 'Your worksheet'],
        },
        {
            chapter: 12,
            title: 'Collaborative Agreements for Owners in Reduced and Restricted States',
            page: 42,
            sections: [
                'What your state may require',
                'Collaborator vs medical director',
                'Fee structure: flat and fair market value',
                'Terms checklist',
                'Malpractice',
                'Your backup plan',
            ],
        },
        {
            chapter: 13,
            title: 'Templates You Can Copy',
            page: 45,
            sections: ['Launch tracker', 'Payer application log', 'Good Faith Estimate', 'NP clinic intake packet', 'Fee schedule template'],
        },
        { title: 'Sources and Update Log', page: 49, sections: [] },
    ],
    keyFigures: [
        {
            title: 'Practice authority by state',
            figure: '27 states and DC',
            text: "Full practice in AANP's October 2026 classification, with 12 states reduced and 11 restricted. The tier is only a starting point: transition hours and each state's own rules decide what you may do. Look up any state in the scope of practice explorer.",
            link: { phrase: 'scope of practice explorer', href: '/scope-of-practice' },
            source: 'AANP, October 2026 (Chapter 1)',
        },
        {
            title: 'From decision to first claim',
            figure: '120 days',
            text: 'The launch timeline the guide works to, because commercial credentialing alone usually runs 60 to 180 days. You can take cash-pay patients before the payer contracts arrive.',
            source: 'Chapter 3',
        },
        {
            title: 'Forming the entity',
            figure: '$300 to $1,000',
            text: 'The state filing fees for the PLLC or PC that most solo NP owners choose, where state law permits it. Have an attorney confirm in writing which entity your state lets an NP own before you file.',
            source: 'Chapter 2, fees checked October 2026',
        },
        {
            title: 'Startup budget',
            text: 'One-time and monthly costs before equipment and supplies, at the two ends of the range the guide prices.',
            table: {
                columns: ['Launch', 'One-time costs', 'Fixed costs a month'],
                rows: [
                    ['Telehealth or home office, lean', 'About $2,300', 'About $160'],
                    ['Full office', 'About $13,200', 'About $2,100'],
                ],
            },
            source: 'Chapter 11, prices checked October 23, 2026',
        },
        {
            title: 'Malpractice for an owner',
            figure: '$1,838 a year',
            text: 'The CM&F average for a full-time NP in family practice or urgent care at $1 million / $3 million limits. Occurrence cover for a self-employed NP costs from $2,329, and the entity needs to be a named insured too.',
            source: 'CM&F, as cited in Chapter 6 (2026)',
        },
    ],
    faqHeading: 'Common questions about opening an NP practice',
    faq: [
        {
            question: 'Can a nurse practitioner open their own practice?',
            answer: 'In many states, yes, but four questions decide it: your state\'s practice authority, any transition hours you must finish first, who may own a clinical business there, and whether your niche needs a physician medical director. Chapter 1 answers the first two state by state; Chapter 2 covers entities, ownership rules and med spas. Then email your board of nursing to confirm your status in writing.',
        },
        {
            question: 'What states let a nurse practitioner open their own practice?',
            answer: "AANP's October 2026 classification lists 27 states and DC as full practice: Alaska, Arizona, Colorado, Connecticut, Delaware, Hawaii, Idaho, Iowa, Kansas, Maine, Maryland, Massachusetts, Minnesota, Montana, Nebraska, Nevada, New Hampshire, New Mexico, New York, North Dakota, Oregon, Rhode Island, South Dakota, Utah, Vermont, Washington and Wyoming. Several of them require transition hours first. NPs own practices in reduced and restricted states too, with a collaborator or supervising physician.",
        },
        {
            question: 'Can a nurse practitioner own a medical spa?',
            answer: 'It depends on the state. Injectables, lasers and certain peels count as medical practice in many states, even inside a spa, so many require a physician medical director or physician ownership, and some keep a spa owner without a license out of the clinical side entirely. Chapter 2 lists the checks to make and the management services organization model some owners use. Ask an attorney before anyone invests.',
        },
        {
            question: 'How much does an NP make owning a practice?',
            answer: 'The guide makes no income projection, because owner pay depends on your costs, payer rates and visit volume. It gives you the math instead: a break-even worksheet that turns your fixed monthly costs and net collection per visit into the visits you need, and the owner pay those visits support. For what employed NPs earn, see the nurse practitioner salary guide.',
            link: { phrase: 'nurse practitioner salary guide', href: '/salary-guide' },
        },
        {
            question: 'How long does it take to open an NP clinic?',
            answer: 'About 120 days from decision to your first insurance claim if you work the steps in order, because commercial credentialing alone usually takes 60 to 180 days. You can start seeing cash-pay patients earlier, as soon as the entity, malpractice cover, EHR and HIPAA policies exist, before the payer contracts come through.',
        },
        {
            question: 'Does your certification limit what your clinic can offer?',
            answer: 'Yes, even in a full-practice state. An FNP can see all ages, an AGPCNP sees no pediatric patients, a women\'s health practice may need physician involvement for general obstetrics, and an outpatient primary care clinic is usually outside an AGACNP\'s acute care focus. Match the clinic you plan to your certified population. For the steps beyond the license, see how to start an NP private practice.',
            link: { phrase: 'how to start an NP private practice', href: '/resources/private-practice-guide' },
        },
    ],
};

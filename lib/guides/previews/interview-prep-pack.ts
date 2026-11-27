import type { GuidePreview } from './types';

/**
 * Preview copy for /guides/interview-prep-pack. The blog's NP interview
 * questions post keeps the head phrase; this page answers the search for the
 * questions and answers as a PDF. Every figure restates the NP Interview
 * Prep Pack: BLS figures are May 2025, AANP figures are from AANP's 2024
 * report (2023 earnings).
 *
 * The excerpt is Chapter 1 (printed pages 2 to 5) as the PDF prints it. The
 * changes: the AANP rows of the pay anchor table carry their earnings year,
 * the "New-grad reality" paragraph is set in reading order (the PDF wraps it
 * around a page break), ``` fences mark the pay script and the note template
 * the PDF sets apart, and ** marks the run-in leads it sets in bold. No
 * clinical scenario, model answer or dose appears anywhere on the page.
 */
export const INTERVIEW_PREP_PACK_PREVIEW: GuidePreview = {
    noun: 'pack',
    seo: {
        title: 'Nurse Practitioner Interview Questions and Answers PDF',
        description: 'How NP interviews run, round by round, with a six-step frame for clinical questions and a telehealth note template. Read Chapter 1 of the NP prep pack.',
    },
    h1: 'Nurse Practitioner Interview Questions and Answers: The NP Interview Prep Pack',
    intro: 'Most NP hiring processes use up to four rounds: a recruiter screen, a clinical interview, a team and culture interview and, at many telehealth employers, a mock video visit followed by a written note. Chapter 1, below, shows what each round tests and how to prepare for it. The full PDF adds 12 clinical scenarios with model answers across five NP specialties.',
    edition: { name: 'January 2027', updated: '2026-11-27' },
    contentDate: '2026-11-27',
    excerpt: {
        heading: 'Read Chapter 1: How NP Interviews Are Structured',
        note: 'Printed pages 2 to 5 of the pack: the four rounds, the recruiter screen with its pay anchors and script, the six-step clinical frame, and the telehealth mock visit with a note template.',
        pages: [2, 3, 4, 5],
        body: `
## Chapter 1: How NP Interviews Are Structured

Most NP hiring processes use up to four rounds, and telehealth employers often add a mock video visit with a written note. Each round tests something different, so prepare for each one separately.

| Round | Who runs it | Typical length (varies) | What they test | How to prepare |
| 1. Recruiter screen | Recruiter or talent partner | 15 to 30 minutes, phone or video | Licenses, DEA, certification, start date, pay, schedule | Have your license list, DEA states and pay range written down |
| 2. Clinical interview | Medical director, lead physician or senior NP | 30 to 60 minutes | Clinical reasoning, red flags, guideline knowledge, when to escalate | Rehearse Chapter 3 with the six-step frame below |
| 3. Team and culture interview | Nurses, MAs, practice manager, other APPs | 30 to 45 minutes | Collaboration, communication, workload, fit | Use your STAR stories from Chapter 2 |
| 4. Telehealth mock visit and note | Clinical lead playing a patient, plus a reviewer | 20 to 45 minutes, plus note time | Telehealth presence, triage, prescribing judgment, note quality | Practice the visit order and note template below |

Lengths and order vary by employer. Ask the recruiter for the full sequence and the names and roles of everyone you will meet. Hospital and acute care roles may add a panel interview or a shadow shift.

### Round 1: The recruiter screen

The recruiter screen checks paperwork and pay fit, not clinical skill. Answer in short, exact sentences.

**"Which states are you licensed in?"** List each active APRN license, each pending application with its filing date, and each state DEA registration.

**"Are you board certified?"** Name the credential and board (for example FNP-C from AANPCB or FNP-BC from ANCC) and its expiration date. New grads give their exam date.

**"When can you start?"** Give a date that allows for credentialing. Commercial payer credentialing typically takes 60 to 180 days.

**"What are your pay expectations?"** Give a researched range, not a single number. Use the script below.

| Pay anchor | Figure | Source type |
| BLS median, all NPs (May 2025) | $132,300 ($63.61/hour) | Employer survey, W-2 wages |
| BLS middle half, all NPs | $117,990 to $156,700 | Employer survey |
| BLS 90th percentile | $174,420 | Employer survey |
| AANP mean total compensation, family practice (2023 earnings) | $125,226 | Self-reported survey |
| AANP mean total compensation, dermatology (2023 earnings) | $165,921 | Self-reported survey |
| Top state medians: California, New Jersey, Washington | $168,520; $159,310; $156,100 | Employer survey |

Pay range script (recruiter screen)

\`\`\`
"Based on the role and my research, I'm targeting a base of $[low] to $[high]. For reference, the BLS median for NPs is $132,300, and the middle half earns $117,990 to $156,700. I'm flexible depending on benefits, malpractice and tail coverage, call and the schedule. What range has the team budgeted for this position?"
\`\`\`

**New-grad reality:** New-grad primary care offers in average-cost states often fall in the BLS 10th to 25th percentile band of $101,340 to $117,990. Urgent care roles are often paid hourly, so ask for the hourly rate and the expected shifts per month.

### Round 2: The clinical interview

The medical director wants a safe, repeatable structure in about three minutes per case. Use the same six steps for every scenario in Chapter 3.

1. **Stability first.** Check airway, breathing, circulation, vital signs and red flags, and say what you would do if the patient is unstable.

2. **Focused history.** Ask about onset, timing, severity, associated symptoms, medications, allergies and risk factors.

3. **Focused exam and differential.** Name the dangerous diagnoses you must rule out, then the most likely ones.

4. **Targeted workup.** Name the specific labs, imaging or tests and why you would order each.

5. **Plan with the guideline.** Give treatment options from current guidelines, the shared decision with the patient and the monitoring.

6. **Disposition and follow-up.** State home, admit, transfer or refer, the follow-up interval, return precautions and who you would consult.

Say out loud when you would call the physician, transfer to the ED or consult a specialist. Interviewers score that as judgment, not weakness.

### Round 3: The team and culture interview

Nurses, medical assistants and practice managers want to know whether you will be easy to work with on a full clinic day. Expect questions on conflict, handoffs, workload and how you respond to a staff member's safety concern.

Bring specifics: how you handle inbox messages, how you delegate refills and prior authorizations, and how fast you return staff calls. Use your Chapter 2 stories and say "I" for what you did.

### Round 4: The telehealth mock visit and documentation sample

Telehealth employers often ask you to run a short visit with a staff member playing the patient, then write the note. Urgent care platforms often use a common complaint, such as a sore throat, urinary symptoms or a cough.

Run every mock visit in this order:

1. Confirm identity (name and date of birth, plus photo ID where required) and the patient's current physical location, including the state.

2. Confirm a callback number and an emergency contact.

3. Confirm consent for telehealth and ask who else is in the room.

4. Screen for red flags that need in-person or emergency care before going further.

5. Take the history with the six-step frame and guide the patient through a remote exam.

6. Close with the plan, return precautions, the follow-up date and when to go to the ED.

**Setup:** camera at eye level, light in front of you, plain background, wired internet if possible, headphones and a closed door.

\`\`\`
TELEHEALTH VISIT NOTE (real-time audio-video)
Identification: [name], DOB [ ], identity verified by [photo ID / two identifiers]
Patient location: [street address], [state]; callback [phone]; emergency contact [name, phone]
Consent: telehealth consent obtained; others present: [none / names]
Chief complaint: "[patient's words]"
HPI: onset, location, duration, character, severity, timing, modifying factors, associated symptoms, treatments tried
Red-flag screen: [listed and negative / positive, with disposition]
ROS: pertinent positives and negatives
PMH / medications / allergies / pregnancy status (if applicable):
Patient-reported vitals: temp [ ], HR [ ], BP [ ], SpO2 [ ] (device: [ ])
Remote exam: general appearance, work of breathing, skin, guided self-exam findings; limits of video exam stated
Assessment: diagnosis with ICD-10-CM code; differential considered
Plan: treatment (risks, benefits, alternatives discussed), tests ordered, antibiotic decision and rationale, patient education
Return precautions: in-person care or ED / 911 for [specific symptoms]
Follow-up: [interval]; PCP notified [yes/no]
Time / MDM: [total time or MDM level]
\`\`\`
`,
        bridge: 'That is Chapter 1 of 7. The full pack adds the STAR worksheet with 12 behavioral questions, 12 clinical scenarios with model answers and 20 more practice prompts, telehealth platform and regulatory questions, 14 questions to ask the employer and a 7-day mock interview plan.',
    },
    disclaimer: 'This guide is for education only. It is not legal, tax, financial, billing or clinical advice.',
    toc: [
        { title: 'About This Guide', page: 1, sections: [] },
        {
            chapter: 1,
            title: 'How NP Interviews Are Structured',
            page: 2,
            inExcerpt: true,
            sections: [
                'Round 1: The recruiter screen',
                'Round 2: The clinical interview',
                'Round 3: The team and culture interview',
                'Round 4: The telehealth mock visit and documentation sample',
            ],
        },
        {
            chapter: 2,
            title: 'Behavioral Questions and the STAR Worksheet',
            page: 6,
            sections: [
                'The STAR method',
                'Your six core stories',
                'The STAR worksheet',
                'Twelve behavioral questions to rehearse',
                'Model answer 1: Safety catch (Q1)',
                'Model answer 2: Disagreement with a colleague (Q2)',
                'Model answer 3: Heavy workload (Q6)',
                'Five delivery rules',
            ],
        },
        {
            chapter: 3,
            title: 'Clinical Scenarios with Model Answers',
            page: 9,
            sections: [
                'Scenario 1: Type 2 diabetes, A1c 8.4% on metformin',
                'Scenario 2: Blood pressure 162/98',
                'Scenario 3: "Z-pack" for a 3-day cough',
                'Scenario 4: Depression in primary care',
                'Scenario 5: Chest pain in a 45-year-old smoker',
                'Scenario 6: Ankle injury',
                'Scenario 7: Child with fever and petechial rash',
                'Scenario 8: Post-op HR 118, BP 88/50, lactate 4',
                'Scenario 9: Potassium 6.8 with peaked T waves',
                'Scenario 10: New atrial fibrillation with rapid ventricular response, stable',
                'Scenario 11: Pediatrics (two linked questions)',
                "Scenario 12: Women's health (two linked questions)",
                'Practice list: 20 more questions without model answers',
            ],
        },
        {
            chapter: 4,
            title: 'Telehealth Platform Interview Questions',
            page: 25,
            sections: [
                '1. "How do you verify a patient\'s identity and location?"',
                '2. "The video drops while a patient describes chest pain or trouble breathing. What do you do?"',
                '3. "How do you do a physical exam by video?"',
                '4. "When do you send a telehealth patient for in-person care?"',
                '5. "What are your standards for asynchronous visits?"',
                '6. "How do you practice antibiotic stewardship by telehealth?"',
                '7. "A patient asks you to treat something outside your scope or certification."',
                '8. "Do you prescribe controlled substances by telehealth?"',
                'Platform question checklist',
            ],
        },
        {
            chapter: 5,
            title: 'Regulatory and Ethics Questions',
            page: 27,
            sections: [
                'Practice authority and transition to practice',
                'DEA registration and the MATE Act',
                'HIPAA in a home office',
                'Mandatory reporting',
                'Documenting medical necessity',
                'Five more ethics prompts',
            ],
        },
        {
            chapter: 6,
            title: 'Questions to Ask the Employer',
            page: 30,
            sections: ['How to ask without sounding demanding'],
        },
        {
            chapter: 7,
            title: 'Mock Interview Plan and Day-Before Checklist',
            page: 32,
            sections: ['The 7-day plan', 'Which scenarios to prioritize', 'Mock interview scoring rubric', 'Day-before checklist', 'After the interview'],
        },
        { title: 'Sources and Update Log', page: 35, sections: [] },
    ],
    keyFigures: [
        {
            title: 'The four rounds',
            text: 'What each round of an NP interview usually takes. Ask the recruiter for the full sequence, because order and length vary by employer.',
            table: {
                columns: ['Round', 'Run by', 'Length'],
                rows: [
                    ['Recruiter screen', 'Recruiter or talent partner', '15 to 30 minutes'],
                    ['Clinical interview', 'Medical director, lead physician or senior NP', '30 to 60 minutes'],
                    ['Team and culture', 'Nurses, MAs, practice manager, other APPs', '30 to 45 minutes'],
                    ['Telehealth mock visit', 'A clinical lead as the patient, plus a reviewer', '20 to 45 minutes, plus the note'],
                ],
            },
            source: 'Chapter 1',
        },
        {
            title: 'The pay anchor for the recruiter screen',
            figure: '$132,300',
            text: 'The BLS median for all NPs, with the middle half at $117,990 to $156,700. Quote a researched range rather than one number, then ask what the team has budgeted.',
            source: 'BLS OEWS, May 2025 (Chapter 1)',
        },
        {
            title: 'Behavioral questions',
            figure: '6 stories, 12 questions',
            text: 'Six prepared STAR stories cover the twelve behavioral questions the pack has you rehearse: a safety catch, a disagreement with a colleague, a difficult patient or family, a mistake you owned, advocacy and a heavy workload.',
            source: 'Chapter 2',
        },
        {
            title: 'Clinical scenarios',
            figure: '12 with model answers',
            text: 'Primary care, urgent care, acute care, pediatric and women\'s health cases answered in full, plus 20 more practice prompts to answer on your own. The table of contents lists every scenario.',
            source: 'Chapter 3, guidelines as of October 2026',
        },
        {
            title: 'Credentialing time',
            figure: '60 to 180 days',
            text: 'How long commercial payer credentialing typically takes, which is why a start date you give a recruiter should leave room for it.',
            source: 'Chapter 1',
        },
    ],
    faqHeading: 'Common questions about NP interviews',
    faq: [
        {
            question: 'What are the most common nurse practitioner interview questions?',
            answer: 'They follow the rounds. A recruiter asks which states you are licensed in, whether you are board certified, when you can start and what pay you expect. A medical director gives you clinical cases and listens for structure and when you would escalate. The team asks about conflict, handoffs and workload, and telehealth employers often run a mock video visit. For a longer list, see our NP interview questions with sample answers.',
            link: { phrase: 'NP interview questions with sample answers', href: '/blog/np-interview-questions' },
        },
        {
            question: 'Is there a PDF of nurse practitioner interview questions and answers?',
            answer: 'Yes. The NP Interview Prep Pack is a PDF with 12 clinical scenarios answered in full across five NP specialties, 20 more practice prompts, 12 behavioral questions with a STAR worksheet, telehealth platform and regulatory questions, questions to ask the employer and a 7-day mock interview plan. Chapter 1 is on this page.',
        },
        {
            question: 'How should you answer clinical scenario questions in an NP interview?',
            answer: 'Use the same six steps for every case: stability first, a focused history, a focused exam with the dangerous diagnoses you must rule out, a targeted workup, a plan from current guidelines, and a disposition with follow-up. Aim for about three minutes per case, and say out loud when you would call the physician, transfer to the ED or consult a specialist.',
        },
        {
            question: 'How should you answer the salary question in an NP interview?',
            answer: 'Give a researched range, not a single number, and name your source. The pack\'s script cites the BLS median for NPs, $132,300, and the middle half, $117,990 to $156,700 (May 2025), says what else you will weigh, such as malpractice, tail coverage and call, and asks what range the team has budgeted. New-grad primary care offers in average-cost states often fall between $101,340 and $117,990.',
        },
        {
            question: 'What should you ask the employer in an NP interview?',
            answer: 'Chapter 6 lists 14 questions, each with a green-flag and a red-flag answer: patients per day and visit length, who your collaborating or supervising physician is and how fast you can reach them, paid admin time, how productivity is measured, who covers licenses, DEA and CE, who pays tail coverage, onboarding, and notice periods. Save questions about pay and the contract for the recruiter screen or the written offer.',
        },
        {
            question: 'What happens in a telehealth mock visit?',
            answer: 'A staff member plays the patient, often with a common urgent care complaint such as a sore throat, urinary symptoms or a cough, and you then write the note. Run it in order: confirm identity and the patient\'s location, a callback number, consent and who is in the room, screen for red flags, take the history and guide a remote exam, then close with the plan and return precautions.',
        },
    ],
};

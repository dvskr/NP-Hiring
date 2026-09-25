// FORK NOTE: this module is the board's YMYL regulatory dataset — per-state
// scope-of-practice authority for the profession declared in config/brand.ts.
// Its public API is re-exported by config/niche/regulatory.ts — the per-niche
// regulatory seam. A fork replaces this module with its own niche's
// equivalent (same interface); do not ship these claims on another niche.
/**
 * State Practice Authority Data
 *
 * Practice authority levels: AANP's classification of the three state
 * practice environments (full, reduced, restricted). What AANP means by each
 * tier is getAanpTierDefinition below. A tier never states a rule for one
 * state: states in the same tier differ (transition periods, practice
 * agreements, routes out of an agreement), so every per-state claim comes
 * from that state's `details`.
 *
 * Source: American Association of Nurse Practitioners (AANP) State Practice Environment
 * Last updated: 2026
 */
import { brand } from '@/config/brand';

/**
 * Credential tokens for the `details` prose below.
 *
 * WHY: every `details` string is published VERBATIM on public YMYL surfaces —
 * the Practice Authority card on ~663 /jobs/{setting}/{state} pages
 * (lib/pseo/setting-state-template.tsx), the body prose and the FAQPage
 * JSON-LD on the 51 /jobs/state/{state} hubs, /resources/fpa-guide, and the
 * licensure-checker result panel. They previously named the DONOR board's
 * single specialty as the subject of every sentence ("…s in Alaska can
 * practice independently"), which is both wrong copy for this board and a
 * scope-of-practice claim about the wrong cohort. AANP classifies the state
 * environment for nurse practitioners as a whole, so these tokens are the
 * accurate subject as well as the fork-safe one: the legal substance of each
 * entry below is unchanged, only the profession wording moved.
 * Derive from brand.niche — never hardcode a credential here.
 */
const NP = brand.niche.short;
const NPS = `${brand.niche.short}s`;

export type PracticeAuthority = 'full' | 'reduced' | 'restricted';

export interface StatePracticeInfo {
    authority: PracticeAuthority;
    description: string;
    details: string;
}

// Practice authority by state
export const STATE_PRACTICE_AUTHORITY: Record<string, StatePracticeInfo> = {
    // Full Practice Authority States (27 states + DC)
    'Alaska': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `${NPS} in Alaska can practice independently, including prescribing controlled substances, without physician oversight.`,
    },
    'Arizona': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Arizona grants full practice authority to ${NPS}. After certification by the Board of Nursing, they can diagnose and treat patients, and prescribe once the Board grants prescribing and dispensing authority, all without physician supervision, a collaborative agreement or a transition period.`,
    },
    'Colorado': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Colorado ${NPS} can practice independently and prescribe medications, including controlled substances. ${NPS} new to prescribing first receive provisional prescriptive authority and must complete a 750 hour prescribing mentorship with a physician or an advanced practice registered nurse who has full prescriptive authority within three years to earn full prescriptive authority.`,
    },
    'Connecticut': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Connecticut requires ${NPS} to practice in collaboration with a physician for at least three years and 2,000 hours before practicing independently. After meeting that requirement, an ${NP} must give written notice to the Department of Public Health before practicing without a collaborative agreement.`,
    },
    'Delaware': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Delaware grants full practice and prescriptive authority to ${NPS} when the Board of Nursing issues their advanced practice registered nurse license, and state law requires no collaborative agreement or supervised experience period after licensure.`,
    },
    'District of Columbia': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Washington, D.C. grants full practice authority to ${NPS}.`,
    },
    'Hawaii': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Hawaii ${NPS} can practice independently with full prescriptive authority.`,
    },
    'Idaho': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Idaho grants full practice authority to ${NPS}.`,
    },
    'Iowa': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Iowa ${NPS} have independent practice and prescriptive authority.`,
    },
    'Maine': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Maine ${NPS} may prescribe from licensure, including controlled substances in schedules II through V, but must practice for at least 24 months under the supervision of a licensed physician or a supervising ${NP}, or be employed by a clinic or hospital whose medical director is a licensed physician, before practicing independently. A 2026 law replaces this requirement once the Board of Nursing adopts new practice standards by rule, so confirm the current requirement with the Board.`,
    },
    'Maryland': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Maryland grants full practice authority to ${NPS}. Applicants who have never been certified as ${NPS} by any board of nursing must name a mentor on their application, a physician or ${NP} licensed in Maryland with at least three years of clinical practice experience, who is available for consultation and collaboration for 18 months starting on the date the Maryland Board of Nursing receives the application.`,
    },
    'Minnesota': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Minnesota ${NPS} must first practice at least 2,080 hours under a collaborative agreement with a physician or with an advanced practice registered nurse who has at least three years of practice, and ${NPS} who provide services other than primary care or mental health services must complete those hours in a setting where advanced practice registered nurses and physicians work together. After that, they may practice independently.`,
    },
    'Montana': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Montana grants full practice authority to ${NPS}.`,
    },
    'Nebraska': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Nebraska ${NPS} have full practice authority after a transition period.`,
    },
    'Nevada': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Nevada grants full practice authority to ${NPS}, but until they have at least 2 years or 2,000 hours of clinical experience they may prescribe Schedule II controlled substances only under a protocol approved by a collaborating physician. ${NPS} who completed their program more than 2 years before applying and have never held an APRN license must complete 1,000 hours of supervised practice without prescribing.`,
    },
    'New Hampshire': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `New Hampshire ${NPS} can practice independently.`,
    },
    'New Mexico': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `New Mexico grants full practice authority to ${NPS}.`,
    },
    'North Dakota': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `North Dakota ${NPS} have independent practice authority.`,
    },
    'Oregon': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Oregon grants full practice authority to ${NPS}.`,
    },
    'Rhode Island': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Rhode Island ${NPS} can practice independently.`,
    },
    'South Dakota': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `South Dakota ${NPS} need a written collaborative agreement with a physician, certified nurse practitioner or certified nurse midwife licensed in South Dakota until they have completed 1,040 hours of licensed practice. After that, they can practice without a collaborative agreement.`,
    },
    'Vermont': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Vermont ${NPS} have independent practice authority once they complete the transition to practice. Until they have 24 months and 2,400 hours of licensed active advanced nursing practice in their role and population focus, they must have a collaborative provider agreement with a Vermont licensed physician or advanced practice registered nurse and may not engage in solo practice.`,
    },
    'Washington': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Washington grants full practice authority to ${NPS}.`,
    },
    'Wyoming': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Wyoming ${NPS} can practice independently.`,
    },
    'Utah': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Utah grants full practice authority to ${NPS}.`,
    },
    'Kansas': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Kansas ${NPS} have full independent practice authority.`,
    },
    // ── 2026-07 correction (P1 #11) ──
    // New York and Massachusetts were carried as 'reduced', which put this
    // dataset at 25 states + DC while three other places in the repo assumed
    // 27 states + DC: this block's own header, the section counts below
    // (12 reduced / 11 restricted — which only sum to 51 jurisdictions if
    // these two are full), and STAT_SOURCES.fullPracticeStates ('27 states +
    // DC', AANP State Practice Environment) as rendered on /jobs, /faq,
    // /salary-guide and /for-employers/resources/how-to-hire.
    // AANP classifies both as Full Practice: NY under the Nurse Practitioner
    // Modernization Act (permanent since 2022), MA under Chapter 227 of the
    // Acts of 2020 (effective 2021). Both carry an experience threshold, so
    // the details strings state it rather than promising day-one autonomy.
    'New York': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `${NPS} in New York with 3,600 hours of practice or fewer must practice in collaboration with a physician under a written practice agreement and written practice protocols. ${NPS} with more than 3,600 hours of practice are currently exempt from those requirements.`,
    },
    'Massachusetts': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Massachusetts grants full practice authority to ${NPS} once they attest to the Board of Registration in Nursing that they have completed at least two years of supervised practice; until then, a qualified healthcare professional, who may be a physician or an experienced ${NP}, supervises their prescribing. ${NPS} applying by reciprocity who have at least two years of ${NP} practice outside Massachusetts, independent or supervised, may instead prescribe without supervision once they attest to that experience.`,
    },

    // Reduced Practice States (12 states)
    'Alabama': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Alabama requires ${NPS} to practice under a collaborative practice agreement with a physician. For ${NPS} with less than two years (4,000 hours) of collaborative practice experience since initial certification or in the collaborating physician's specialty, the collaborating physician or an approved covering physician must be present for at least 10 percent of scheduled hours, although certain settings and limited protocols are exempt.`,
    },
    'Arkansas': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Arkansas ${NPS} need a collaborative practice agreement, typically with a physician, to prescribe unless they hold a certificate of full independent practice authority. An ${NP} can apply for that certificate after 6,240 hours of practice under an agreement with a physician or with prescriptive authority in another jurisdiction.`,
    },
    'Illinois': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Illinois requires ${NPS} to have a written collaborative agreement until they obtain full practice authority, except when they practice under clinical privileges in a hospital, hospital affiliate or ambulatory surgical treatment center. Full practice authority requires a notarized attestation of at least 4,000 hours of clinical experience after first attaining national certification and at least 250 hours of continuing education or training.`,
    },
    'Indiana': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Indiana ${NPS} must practice under a collaborative agreement with a physician.`,
    },
    'Kentucky': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Kentucky ${NPS} need a collaborative agreement with a physician to prescribe, with separate agreements for nonscheduled legend drugs and for controlled substances. Once ${NPS} have four years of prescribing experience, which can include prescribing in another state, they may prescribe without these agreements, though dropping the controlled substance agreement first requires a Board of Nursing good standing review.`,
    },
    'Louisiana': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Louisiana ${NPS} must have a collaborative practice agreement.`,
    },
    'Mississippi': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Mississippi requires ${NPS} to have a collaborative practice agreement.`,
    },
    'New Jersey': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `New Jersey generally requires ${NPS} to have joint protocols with a collaborating physician in order to prescribe or order medications and devices. Under a 2026 law, ${NPS} in a qualifying population focus with more than 5,000 hours of advanced practice who provide primary or behavioral health care, and do not provide general obstetrics or elective aesthetic or cosmetic services, may practice and prescribe without a joint protocol.`,
    },
    'Ohio': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Ohio ${NPS} must have a standard care arrangement with a collaborating physician.`,
    },
    'Pennsylvania': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Pennsylvania requires a collaborative agreement for ${NP} practice.`,
    },
    'West Virginia': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `West Virginia ${NPS} must have a collaborative agreement with a physician to prescribe unless the Board of Registered Nurses has approved removal of that requirement. An ${NP} may apply for removal after at least three years of practice in a documented collaborative relationship with prescriptive authority.`,
    },
    'Wisconsin': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Wisconsin ${NPS} must practice in collaboration with a physician or dentist until the Board of Nursing verifies that they qualify for independent practice. Qualifying requires, among other things, 3,840 clinical hours in their role while working with a physician or dentist and at least 24 months since they began that practice.`,
    },

    // Restricted Practice States (11 states)
    'California': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `California ${NPS} generally practice under standardized procedures developed collaboratively with physicians and furnish drugs and devices under physician supervision. ${NPS} who complete a transition to practice in California of three full-time equivalent years or 4,600 hours can be certified to practice without standardized procedures in a group setting with a physician, and usually after at least three more years in good standing, in an independent setting.`,
    },
    // The absolute phrasing this entry carried ("requires physician
    // supervision for … practice. …s must work under a supervisory protocol.")
    // was true of the donor board's single psych specialty, which the carve-out
    // below excludes. Re-subjected to nurse practitioners as a whole it became
    // false for the largest cohort on this board AND contradicted the repo's own
    // data (lib/metro-data.ts:252/264/725 document Florida's 2020 pathway).
    // It ships verbatim on /jobs/family-practice/florida and
    // /jobs/primary-care/florida — the exact cohort the carve-out covers — plus
    // the /jobs/state/florida body prose and its FAQPage JSON-LD. Fixed the way
    // P1 #11 fixed NY/MA above: the AANP tier is still 'restricted' (the carve-
    // out is specialty-limited, so the state environment is unchanged), only
    // the sentence gains the qualifying clause it was always missing.
    'Florida': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Florida requires ${NPS} to practice under a supervisory protocol with a physician. Since 2020, ${NPS} who meet eligibility requirements may register for autonomous practice limited to primary care, including family medicine, general pediatrics, and general internal medicine; the requirements include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology.`,
    },
    'Georgia': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Georgia requires ${NPS} to practice under physician supervision with a protocol agreement.`,
    },
    'Michigan': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Michigan ${NPS} may prescribe nonscheduled prescription drugs on their own authority, but may prescribe controlled substances in schedules 2 to 5 only as a delegated act of a physician under the physician's written authorization.`,
    },
    'Missouri': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Missouri requires ${NPS} to have a collaborative practice arrangement with physician supervision.`,
    },
    'North Carolina': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `North Carolina requires ${NPS} to practice under physician supervision.`,
    },
    'Oklahoma': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Oklahoma ${NPS} who prescribe must have a written supervision agreement with a supervising physician until the Board of Nursing grants them independent prescriptive authority. ${NPS} who have completed 6,240 clinical practice hours with prescriptive authority supervised by a physician may apply for that independent authority.`,
    },
    'South Carolina': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `South Carolina ${NPS} must perform medical acts under a practice agreement with a physician, who must be readily available for consultation.`,
    },
    'Tennessee': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Tennessee requires physician supervision for ${NPS}.`,
    },
    'Texas': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Texas requires ${NPS} to have a prescriptive authority agreement with a supervising physician.`,
    },
    'Virginia': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Virginia ${NPS} must maintain a practice agreement documenting collaboration and consultation with a patient care team physician. An ${NP} with the equivalent of at least three years of full-time clinical experience can apply for a license designation to practice without a practice agreement.`,
    },
};

/**
 * Get practice authority info for a state
 */
export function getStatePracticeAuthority(stateName: string): StatePracticeInfo | null {
    return STATE_PRACTICE_AUTHORITY[stateName] || null;
}

/**
 * Get all states with a specific practice authority level
 */
export function getStatesByAuthority(authority: PracticeAuthority): string[] {
    return Object.entries(STATE_PRACTICE_AUTHORITY)
        .filter(([, info]) => info.authority === authority)
        .map(([state]) => state);
}

/**
 * AANP's own name for the tier: "Full Practice", "Reduced Practice" or
 * "Restricted Practice", exactly as its State Practice Environment map
 * labels them.
 *
 * WHY no rule rides along: this label used to read "Reduced Practice
 * (Collaborative Agreement Required)" and "Restricted Practice (Physician
 * Supervision Required)", and every consumer printed it directly in front of
 * the state's `details`. A tier is too coarse to carry a rule. Virginia,
 * South Carolina and Michigan are restricted but none requires physician
 * supervision for all practice, and Arkansas, Illinois, Kentucky, New Jersey,
 * West Virginia and Wisconsin are reduced but each has a route out of the
 * agreement (and Wisconsin's may be with a dentist). So the label names the
 * AANP tier and nothing else; what a state actually requires comes from its
 * own `details` string. Callers attribute the tier to AANP in their own
 * sentence (e.g. "AANP classifies Texas as a restricted practice state.").
 */
export function getAuthorityLabel(authority: PracticeAuthority): string {
    switch (authority) {
        case 'full':
            return 'Full Practice';
        case 'reduced':
            return 'Reduced Practice';
        case 'restricted':
            return 'Restricted Practice';
    }
}

/**
 * What AANP means by each tier, as one sentence attributed to AANP, for copy
 * that explains the tier itself (the plain state hub narrative).
 *
 * Closely paraphrased from AANP's own definitions at
 * https://www.aanp.org/advocacy/state/state-practice-environment (page dated
 * 05/2026, read 2026-09-25):
 *   - Full: "State practice and licensure laws permit all NPs to evaluate
 *     patients; diagnose, order and interpret diagnostic tests; and initiate
 *     and manage treatments, including prescribing medications and
 *     controlled substances, under the exclusive licensure authority of the
 *     state board of nursing."
 *   - Reduced: "State practice and licensure laws reduce the ability of NPs
 *     to engage in at least one element of NP practice. State law requires a
 *     career-long regulated collaborative agreement with another health
 *     provider in order for the NP to provide patient care, or it limits the
 *     setting of one or more elements of NP practice."
 *   - Restricted: "State practice and licensure laws restrict the ability of
 *     NPs to engage in at least one element of NP practice. State law
 *     requires career-long supervision, delegation or team management by
 *     another health provider in order for the NP to provide patient care."
 *
 * Deliberately NOT quoted whole. "All NPs" is untrue of the full-tier states
 * with a transition to practice (Colorado, Connecticut, Maine, Maryland,
 * Massachusetts, Minnesota, Nebraska, Nevada, New York, South Dakota,
 * Vermont), and "career-long" is untrue of every reduced or restricted state
 * with a route out (Arkansas, Illinois, Kentucky, New Jersey, West Virginia,
 * Wisconsin; California, Florida, Oklahoma, Virginia). A verbatim quote would
 * contradict the verified `details` printed on the same page, so each
 * definition keeps AANP's own wording minus only what is not true of every
 * state in the tier:
 *   - Full keeps AANP's whole sentence, including "under the exclusive
 *     licensure authority of the state board of nursing", and drops only
 *     "all". It never defines the tier by the absence of a "career-long"
 *     requirement, because read beside the other two definitions (the
 *     planner legend prints all three) that would tell readers the reduced
 *     and restricted states have one. The transition caveat is a separate
 *     sentence, not attributed to AANP (AANP's page says nothing about
 *     transitions); the verified `details` of the states listed above back it.
 *   - Reduced and restricted keep AANP's opening clause and give its
 *     mechanisms as examples ("for example"), without "career-long".
 * None of these sentences may be used to answer a question about one state;
 * that answer is the state's `details`.
 */
export function getAanpTierDefinition(authority: PracticeAuthority): string {
    switch (authority) {
        case 'full':
            return `AANP uses this category where state law lets ${NPS} evaluate patients, diagnose, order and interpret diagnostic tests, and initiate and manage treatment, including prescribing medications and controlled substances, under the exclusive licensure authority of the state board of nursing. Some of these states first require a transition period.`;
        case 'reduced':
            return `AANP uses this category where state law reduces the ability of ${NPS} to engage in at least one element of ${NP} practice, for example through a regulated collaborative agreement with another health provider or a limit on the setting of one or more elements of ${NP} practice.`;
        case 'restricted':
            return `AANP uses this category where state law restricts the ability of ${NPS} to engage in at least one element of ${NP} practice, for example through supervision, delegation or team management by another health provider.`;
    }
}

/**
 * Get color class for practice authority badge
 */
export function getAuthorityColor(authority: PracticeAuthority): {
    bg: string;
    text: string;
    border: string;
} {
    switch (authority) {
        case 'full':
            return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' };
        case 'reduced':
            return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' };
        case 'restricted':
            return { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' };
    }
}

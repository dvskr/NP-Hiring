// FORK NOTE: this module is the board's YMYL regulatory dataset — per-state
// scope-of-practice authority for the profession declared in config/brand.ts.
// Its public API is re-exported by config/niche/regulatory.ts — the per-niche
// regulatory seam. A fork replaces this module with its own niche's
// equivalent (same interface); do not ship these claims on another niche.
/**
 * State Practice Authority Data
 *
 * Practice authority levels (AANP's classification of the three state
 * regulatory environments):
 * - FULL: clinicians may evaluate, diagnose and prescribe independently,
 *   without physician oversight
 * - REDUCED: requires a collaborative agreement with a physician
 * - RESTRICTED: requires physician supervision for practice
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
        details: `Arizona grants full practice authority to ${NPS} after completing a transition-to-practice period.`,
    },
    'Colorado': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Colorado ${NPS} can practice independently and prescribe all medications including controlled substances.`,
    },
    'Connecticut': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Connecticut allows independent ${NP} practice with full prescriptive authority.`,
    },
    'Delaware': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Delaware ${NPS} have independent practice authority after meeting experience requirements.`,
    },
    'District of Columbia': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Washington D.C. grants full practice authority to ${NPS}.`,
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
        details: `Maine allows independent ${NP} practice with full prescriptive authority.`,
    },
    'Maryland': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Maryland grants full practice authority to ${NPS}.`,
    },
    'Minnesota': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Minnesota ${NPS} can practice independently without physician oversight.`,
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
        details: `Nevada grants full practice authority to ${NPS} after 2 years of supervised practice.`,
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
        details: `South Dakota grants full practice authority to ${NPS}.`,
    },
    'Vermont': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Vermont ${NPS} have independent practice authority.`,
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
        details: `Utah grants full practice authority to ${NPS} after completing a mentorship period.`,
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
        details: `New York grants full practice authority to ${NPS} who have completed 3,600 hours of qualifying practice; below that threshold a written collaborative relationship with a physician still applies.`,
    },
    'Massachusetts': {
        authority: 'full',
        description: 'Full Practice Authority',
        details: `Massachusetts grants full practice authority to ${NPS} after at least two years of supervised practice; the supervision requirement applies only during that transition period.`,
    },

    // Reduced Practice States (12 states)
    'Alabama': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Alabama requires ${NPS} to have a collaborative agreement with a physician. The collaborating physician does not need to be on-site.`,
    },
    'Arkansas': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Arkansas ${NPS} must have a collaborative practice agreement with a physician.`,
    },
    'Illinois': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Illinois requires a written collaborative agreement for ${NPS}.`,
    },
    'Indiana': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Indiana ${NPS} must practice under a collaborative agreement with a physician.`,
    },
    'Kentucky': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Kentucky requires a collaborative agreement for ${NP} practice.`,
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
        details: `New Jersey ${NPS} need a collaborative agreement with a physician.`,
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
        details: `West Virginia ${NPS} must have a collaborative agreement with a physician.`,
    },
    'Wisconsin': {
        authority: 'reduced',
        description: 'Reduced Practice',
        details: `Wisconsin requires ${NPS} to have a collaborative relationship with a physician.`,
    },

    // Restricted Practice States (11 states)
    'California': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `California requires physician supervision for ${NPS}. Recent legislation (AB 890) is phasing in expanded practice authority through 2026.`,
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
        details: `Florida requires physician supervision for ${NP} practice under a supervisory protocol; a 2020 law lets ${NPS} with 3,000+ supervised hours in the past five years register for autonomous primary-care practice — family medicine, general pediatrics and general internal medicine only.`,
    },
    'Georgia': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Georgia requires ${NPS} to practice under physician supervision with a protocol agreement.`,
    },
    'Michigan': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `Michigan requires a supervisory agreement between ${NPS} and physicians.`,
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
        details: `Oklahoma requires physician supervision for ${NPS}.`,
    },
    'South Carolina': {
        authority: 'restricted',
        description: 'Restricted Practice',
        details: `South Carolina requires ${NPS} to practice under physician supervision with written protocols.`,
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
        details: `Virginia requires a practice agreement with a supervising physician for ${NPS}.`,
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
 * Get user-friendly label for practice authority
 */
export function getAuthorityLabel(authority: PracticeAuthority): string {
    switch (authority) {
        case 'full':
            return 'Full Practice Authority';
        case 'reduced':
            return 'Reduced Practice (Collaborative Agreement Required)';
        case 'restricted':
            return 'Restricted Practice (Physician Supervision Required)';
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

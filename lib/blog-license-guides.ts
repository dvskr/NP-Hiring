/**
 * State licensure series — deterministic per-state guide generator.
 *
 * Generates all 51 'np-license-<state>' posts (50 states + DC, see
 * LICENSE_GUIDE_SLUG_PREFIX in config/niche/content-map.ts) from
 * structured repo data instead of 51 hand-pasted blobs — the same
 * philosophy as lib/pseo/state-narrative.ts: prose is parameterized on
 * facts, so two states with different facts read genuinely differently
 * (a full-practice compact state and a restricted non-compact state
 * share almost no practice-authority or licensure-path copy).
 *
 * DATA SOURCES (truth rules — nothing else is stated as fact):
 *   - Practice authority level: lib/state-practice-authority.ts (AANP).
 *     The tier is only ever described as AANP's classification, in AANP's
 *     own terms (AANP_TIER_MEANING), with a note that states in one tier
 *     differ. It never answers a question about one state.
 *   - What one state requires (does an NP need a physician, is there a
 *     transition period): that state's `details` string, which a
 *     primary-source audit of all 51 jurisdictions corrected in September
 *     2026, plus the short verdicts in LICENSE_GUIDE_PHYSICIAN_VERDICTS
 *     that restate it (drift-guarded by their `basis` phrases).
 *   - NLC status: LICENSE_GUIDE_NLC_NON_MEMBERS +
 *     LICENSE_GUIDE_NLC_ENACTED_PENDING below — mirror the canonical sets
 *     in lib/pseo/state-narrative.ts (kept in sync by the drift test in
 *     tests/regressions/p1-content-library-license-guides.test.ts),
 *     verified against the live NCSBN roster on NLC_ROSTER_VERIFIED_AT.
 *   - Salary / growth figures: lib/stats-sources.ts, cited inline. Live
 *     state-level numbers render in the page's market snapshot
 *     (components/blog/LicenseGuideMarketSnapshot.tsx, gated on the
 *     target pages rendering), never in this static markdown, which is
 *     also synced into the DB and cannot carry live conditions.
 *   - State rule text: STATE_PRACTICE_AUTHORITY[state].details, quoted
 *     verbatim (LIC-L1), so guides in the same authority tier differ.
 *   - Board contact: the NCSBN member-board directory. Fees, CE hours,
 *     renewal cycles, and processing times are NOT in repo data, so the
 *     guides deliberately never quote them — every such question is
 *     answered with a board link (truth rule: link, don't invent).
 *
 * SERVING: lib/blog.ts resolves license-guide slugs through this module
 * as a fallback when no DB row exists, so once
 * LICENSE_GUIDE_SERIES_PUBLISHED is flipped, all 51 posts render
 * deterministically — the all-or-nothing gate can never 404 a subset.
 * scripts/sync-blog-to-db.ts --license-guides upserts the same output
 * into the blog_posts table (single transaction) so DB-reading surfaces
 * (/resources state grid, /blog index) list the series too.
 */
// Relative imports (not '@/') so scripts/sync-blog-to-db.ts can load this
// module under plain tsx/ts-node without tsconfig-path registration.
import { brand } from '../config/brand';
import { licenseGuideSlug } from '../config/niche/content-map';
import {
    STATE_PRACTICE_AUTHORITY,
    type PracticeAuthority,
} from './state-practice-authority';
import { STAT_SOURCES, type StatSource } from './stats-sources';
import { getNeighboringStates } from './pseo/neighboring-states';
import {
    BENCHMARK_MIN_EMPLOYERS,
    BENCHMARK_MIN_POSTINGS,
} from '../components/tools/benchmark-model';
import type { BlogPost } from './blog';

// ─── Editorial dates (real, fixed — never render-time; audit B54) ───────────

/** Date the series content + data sources were authored/verified. Bump on
 *  each editorial review pass (feeds reviewed_at → BlogPosting.dateModified).
 *  2026-09-25: the practice-authority pass that rebuilt every per-state
 *  answer from the audited dataset. lib/blog.ts also uses this date to let
 *  the generator supersede a blog_posts mirror synced before it. */
export const LICENSE_GUIDE_REVIEWED_AT = '2026-09-25T00:00:00.000Z';
/** Series publish date (fixed so freshness is never fabricated per-render). */
export const LICENSE_GUIDE_PUBLISH_DATE = '2026-07-29T00:00:00.000Z';

// ─── State table ────────────────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

/**
 * Date the two NLC sets below were verified against the live NCSBN
 * roster (the implementation table linked from NLC_LIVE_ROSTER_URL).
 * Real literal — bump it ONLY on an actual re-verification pass.
 */
export const NLC_ROSTER_VERIFIED_AT = '2026-08-11';

/** Live NCSBN compact roster — where every membership claim points. */
export const NLC_LIVE_ROSTER_URL = 'https://www.nursecompact.com/';

/** Human-readable form of NLC_ROSTER_VERIFIED_AT for prose. */
const NLC_VERIFIED_LABEL = new Date(
    `${NLC_ROSTER_VERIFIED_AT}T00:00:00Z`,
).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

/**
 * NLC (Nurse Licensure Compact) NON-member jurisdictions — states with no
 * enacted compact legislation ("currently no action" on the NCSBN map).
 * MIRROR of the canonical (non-exported) set in lib/pseo/state-narrative.ts
 * — that file belongs to the state-hub surface, so the set is duplicated
 * here and guarded by a source-level drift test. Source: NCSBN NLC roster
 * (nursecompact.com implementation table), verified live on
 * NLC_ROSTER_VERIFIED_AT. Update both copies together when membership
 * shifts. History: the pre-2026-08 revision wrongly listed Connecticut
 * (implemented 2025-10-01), Rhode Island (2024-01-08), and Washington
 * (2024-01-31) as non-members, omitted Alaska (a genuine non-member), and
 * carried Massachusetts here when it belongs in the pending set below.
 */
export const LICENSE_GUIDE_NLC_NON_MEMBERS: ReadonlySet<string> = new Set([
    'Alaska', 'California', 'District of Columbia', 'Hawaii', 'Illinois',
    'Michigan', 'Minnesota', 'Nevada', 'New York', 'Oregon',
]);

/**
 * Jurisdictions that have ENACTED the NLC but not yet IMPLEMENTED it.
 * NCSBN lists their implementation date as to-be-determined: until the
 * state board completes implementation, a multistate license is neither
 * issued to residents nor honored for practice there — so a member/
 * non-member boolean cannot represent them honestly, and every consumer
 * renders a distinct "enacted, implementation pending — verify with the
 * board" branch instead. (Guam and the U.S. Virgin Islands share this
 * status on the NCSBN roster but are outside this repo's 51
 * jurisdictions.) Same source, verification date, and drift guard as the
 * non-member set above.
 */
export const LICENSE_GUIDE_NLC_ENACTED_PENDING: ReadonlySet<string> = new Set([
    'Massachusetts',
]);

/** Tri-state compact status — 'pending' = enacted, awaiting implementation. */
export type NlcStatus = 'member' | 'pending' | 'non-member';

function nlcStatusOf(name: string): NlcStatus {
    if (LICENSE_GUIDE_NLC_ENACTED_PENDING.has(name)) return 'pending';
    return LICENSE_GUIDE_NLC_NON_MEMBERS.has(name) ? 'non-member' : 'member';
}

/**
 * Official board display names that don't follow the default
 * "<State> Board of Nursing" pattern.
 *
 * SOURCE + VERIFICATION: every one of the 51 names below (and every one
 * that falls through to the default) was checked against the heading of
 * the NCSBN member-details page each guide LINKS TO, live on 2026-07-29.
 * Matching the link target matters: the guide names the board in prose
 * and then hands the reader a link, so a mismatch reads as a wrong or
 * stale agency on a YMYL page. Five names were wrong before that sweep:
 *   - Connecticut / Pennsylvania / Utah fell through to the default and
 *     are not called "<State> Board of Nursing" at all;
 *   - Washington still carried the pre-2024 name (the Nursing Care
 *     Quality Assurance Commission became the Washington State Board of
 *     Nursing; nursing.wa.gov now uses only the new name);
 *   - West Virginia carried the long statutory title rather than the
 *     board's current name.
 *
 * KNOWN, DELIBERATE DIVERGENCES (2 of 51): NCSBN lists Iowa and
 * Wisconsin under their umbrella agencies (Iowa Department of
 * Inspections, Appeals, & Licensing; Wisconsin Department of Safety and
 * Professional Services). Both states still have a statutory Board of
 * Nursing that sets APRN requirements, and "apply with the Iowa
 * Department of Inspections, Appeals, & Licensing" would be less useful
 * to a licensure reader, so those two keep the board name.
 */
const BOARD_NAME_OVERRIDES: Record<string, string> = {
    'Arizona': 'Arizona State Board of Nursing',
    'Arkansas': 'Arkansas State Board of Nursing',
    'California': 'California Board of Registered Nursing',
    'Connecticut': 'Connecticut Board of Nurse Licensure',
    'Indiana': 'Indiana State Board of Nursing',
    'Kansas': 'Kansas State Board of Nursing',
    'Louisiana': 'Louisiana State Board of Nursing',
    'Maine': 'Maine State Board of Nursing',
    'Massachusetts': 'Massachusetts Board of Registration in Nursing',
    'Missouri': 'Missouri State Board of Nursing',
    'Nevada': 'Nevada State Board of Nursing',
    'New York': 'New York State Board of Nursing',
    'Oregon': 'Oregon State Board of Nursing',
    'Pennsylvania': 'Pennsylvania State Board of Nursing',
    'Rhode Island': 'Rhode Island Board of Nurse Registration and Nursing Education',
    'Utah': 'Utah Board of Nursing and Certified Nurse Midwives',
    'Vermont': 'Vermont State Board of Nursing',
    'Washington': 'Washington State Board of Nursing',
    'West Virginia': 'West Virginia Board of Registered Nurses',
    'Wyoming': 'Wyoming State Board of Nursing',
};

export interface LicenseGuideState {
    /** Full state name, e.g. 'New Hampshire'. */
    name: string;
    /** Postal code, e.g. 'NH'. */
    code: string;
    /** URL slug, e.g. 'new-hampshire' (matches /jobs/state + /salary-guide). */
    stateSlug: string;
    /** Blog slug, e.g. 'np-license-new-hampshire'. */
    slug: string;
    /** AANP practice-authority classification. */
    authority: PracticeAuthority;
    /**
     * Whether the state is a fully implemented Nurse Licensure Compact
     * member. False for BOTH non-members and enacted-pending states —
     * branch on `nlcStatus` wherever the difference must be rendered.
     */
    nlcMember: boolean;
    /** Compact status: member / enacted-pending-implementation / non-member. */
    nlcStatus: NlcStatus;
    /** Board of nursing display name (NCSBN directory naming). */
    boardName: string;
    /** NCSBN member-board directory page (board site, phone, address). */
    boardUrl: string;
}

function stateSlugOf(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Indefinite article for a spoken postal code ("an AZ license", "a CA
 * license"). Letters read with a leading vowel sound take "an" — without
 * this, interpolation produces "a AZ" on 30 of the 51 guides.
 */
function codeArticle(code: string): 'a' | 'an' {
    return 'AEFHILMNORSX'.includes(code[0]) ? 'an' : 'a';
}

/**
 * NCSBN member-detail slug exceptions.
 *
 * The directory slug is the state name minus spaces for 50 of the 51
 * jurisdictions — but not New Mexico: /bon-member-details/NewMexico
 * returns HTTP 404 while /bon-member-details/New-Mexico returns 200
 * (all 51 URLs re-checked live 2026-07-29; New Mexico was the only
 * failure, and it shipped as a dead board link in four places on the
 * New Mexico guide — the one link that guide tells readers to trust for
 * fees, forms, and renewal). The hyphenated form is NOT interchangeable:
 * /bon-member-details/New-Jersey 404s, so this stays an exception list
 * rather than a rule change.
 */
const BOARD_URL_SLUG_OVERRIDES: Record<string, string> = {
    'New Mexico': 'New-Mexico',
};

/** NCSBN member-detail URL — state name minus spaces, plus exceptions. */
function ncsbnBoardUrl(name: string): string {
    const slug = BOARD_URL_SLUG_OVERRIDES[name] ?? name.replace(/\s+/g, '');
    return `https://www.ncsbn.org/bon-member-details/${slug}`;
}

/** All 51 jurisdictions, derived from the practice-authority dataset. */
export const LICENSE_GUIDE_STATES: ReadonlyArray<LicenseGuideState> =
    Object.keys(STATE_PRACTICE_AUTHORITY)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
            name,
            code: STATE_CODES[name],
            stateSlug: stateSlugOf(name),
            slug: licenseGuideSlug(stateSlugOf(name)),
            authority: STATE_PRACTICE_AUTHORITY[name].authority,
            nlcMember: nlcStatusOf(name) === 'member',
            nlcStatus: nlcStatusOf(name),
            boardName: BOARD_NAME_OVERRIDES[name] ?? `${name} Board of Nursing`,
            boardUrl: ncsbnBoardUrl(name),
        }));

const LICENSE_STATE_BY_NAME: ReadonlyMap<string, LicenseGuideState> = new Map(
    LICENSE_GUIDE_STATES.map((s) => [s.name, s]),
);

/**
 * LIC-L2: the nearby jurisdictions (lib/pseo/neighboring-states.ts, a
 * proximity list, so copy says "nearby", never "bordering") as guide rows.
 * Feeds the sibling-guide table on the post page and the variation test.
 */
export function getLicenseGuideNearbyStates(stateName: string): LicenseGuideState[] {
    return getNeighboringStates(stateName)
        .map((name) => LICENSE_STATE_BY_NAME.get(name))
        .filter((s): s is LicenseGuideState => s !== undefined);
}

/** Table-cell label for a compact status (the nearby-states table). */
export function nlcTableLabel(status: NlcStatus): string {
    if (status === 'member') return 'Member';
    if (status === 'pending') return 'Enacted, implementation pending';
    return 'Not a member';
}

// ─── Prose builders ─────────────────────────────────────────────────────────

/**
 * Inline citation for prose: "$129,210 (BLS OEWS … May 2024)".
 * Deliberately NOT stats-sources' citedValue(), which appends `asOf` on
 * top of a `source` string that already names its vintage — "May 2024,
 * 2024-05" reads like machine output on 51 pages. The source string is
 * kept verbatim, so the claim stays fully attributed.
 */
function cite(s: StatSource): string {
    return `${s.formatted} (${s.source})`;
}

const NP = brand.niche.short; // 'NP'
const NP_LONG = brand.niche.long; // 'Nurse Practitioner'
const NP_PROSE = brand.niche.descriptor; // 'nurse practitioner'

// ─── Practice authority: AANP's tier versus the state's own rule ────────────
//
// The tier is too coarse to answer a question about one state. AANP puts
// Connecticut, New York and Maine in its full practice tier although a new
// NP there first practices with a collaborator or supervisor, and it puts
// Virginia, Illinois and Wisconsin in the lower tiers although each offers
// a way out of the agreement. So the guides split the two jobs:
//   - Tier copy (AANP_TIER_MEANING and the "states differ" paragraph) says
//     only what AANP's classification means, attributed to AANP.
//   - Every sentence that answers a question about ONE state (the quick
//     answer, both practice FAQs, the practice-requirements step that also
//     ships as HowTo structured data) is the state's audited details string,
//     optionally opened by a short verdict restating it. A state without a
//     verdict gets its details alone: a shorter true answer beats a
//     confident false one.

/**
 * AANP's definitions of the three practice environments, read from the
 * AANP State Practice Environment page (STAT_SOURCES.fullPracticeStates
 * .sourceUrl, marked "Last Updated: 05/2026") on 2026-09-25. Verbatim:
 *   Full: "State practice and licensure laws permit all NPs to evaluate
 *     patients; diagnose, order and interpret diagnostic tests; and
 *     initiate and manage treatments, including prescribing medications and
 *     controlled substances, under the exclusive licensure authority of the
 *     state board of nursing."
 *   Reduced: "State practice and licensure laws reduce the ability of NPs
 *     to engage in at least one element of NP practice. State law requires
 *     a career-long regulated collaborative agreement with another health
 *     provider in order for the NP to provide patient care, or it limits
 *     the setting of one or more elements of NP practice."
 *   Restricted: "State practice and licensure laws restrict the ability of
 *     NPs to engage in at least one element of NP practice. State law
 *     requires career-long supervision, delegation or team management by
 *     another health provider in order for the NP to provide patient care."
 * The close paraphrase below drops two words the audited dataset shows are
 * not true of every state in the tier: "all" (the full practice states
 * with a transition period) and "career-long" (the reduced and restricted
 * states with a route out of the agreement). Note that neither lower tier
 * names a physician: AANP says "another health provider".
 *
 * The reduced and restricted meanings give AANP's mechanisms as EXAMPLES
 * ("for example through"), the same shape getAanpTierDefinition in
 * lib/state-practice-authority.ts and the FPA guide use. Written as "by
 * requiring", the mechanism read as the placement rule: under it, Maine,
 * Massachusetts and Nevada (supervised periods) would be restricted and
 * CT, MN, NY, SD and VT (a collaborative transition) reduced, yet AANP lists
 * all eight as full practice. This text appears in all 51 guides.
 */
export const AANP_TIER_MEANING: Readonly<Record<PracticeAuthority, string>> = {
    full: `AANP applies that classification where state practice and licensure laws permit ${NP}s to evaluate patients; diagnose, order and interpret diagnostic tests; and initiate and manage treatments, including prescribing medications and controlled substances, under the exclusive licensure authority of the state board of nursing.`,
    reduced: `AANP applies that classification where state practice and licensure laws reduce the ability of ${NP}s to engage in at least one element of ${NP} practice, for example through a regulated collaborative agreement with another health provider or a limit on the setting of one or more elements of practice.`,
    restricted: `AANP applies that classification where state practice and licensure laws restrict the ability of ${NP}s to engage in at least one element of ${NP} practice, for example through supervision, delegation or team management by another health provider.`,
};

/** Tier name for prose, e.g. "AANP classifies Ohio as a reduced practice state". */
/**
 * DC is a jurisdiction, not a state (tests/regressions/dc-jurisdiction-wording
 * and authority-tier-copy pin the same rule for the pSEO builders).
 */
const jurisdictionKind = (s: LicenseGuideState): 'state' | 'jurisdiction' =>
    s.code === 'DC' ? 'jurisdiction' : 'state';

const TIER_NAME: Readonly<Record<PracticeAuthority, string>> = {
    full: 'full practice',
    reduced: 'reduced practice',
    restricted: 'restricted practice',
};

/** Why states in the same tier read differently (tier level, AANP-neutral). */
const TIER_VARIES: Readonly<Record<PracticeAuthority, string>> = {
    full: `AANP's classification describes the state's practice environment, not every license holder's first day, and states in the same tier set different conditions: several full practice states require a period of collaborative or supervised practice, or a prescribing mentorship, before a newly licensed ${NP} practices or prescribes on their own.`,
    reduced: `States in the same tier set different conditions: who may serve as the collaborating provider, which elements of practice an agreement covers, and whether experience or a practice setting removes the requirement all vary from state to state.`,
    restricted: `States in the same tier set different conditions: some limit the requirement to certain elements of practice, such as prescribing controlled substances, and some offer a route out of it after a set amount of experience.`,
};

export interface PhysicianVerdict {
    /**
     * Short answer to "Do I need a collaborating or supervising physician
     * in {state}?", always followed by the state's details string, which
     * carries the conditions. Pronoun-free, because the same answer serves
     * the guide ("Do I need…") and the setting-by-state FAQ ("Do NPs need…").
     */
    verdict: string;
    /**
     * Verbatim phrases of the state's details string that the verdict
     * restates. The license-guide test fails when a details edit drops one,
     * so a re-audit of the dataset cannot leave a stale verdict behind.
     */
    basis: readonly string[];
}

/**
 * Verdicts for the states whose details string answers the physician
 * question directly. Absent states (details that only say "grants full
 * practice authority", or name an agreement without naming its parties)
 * get no verdict: the details are published alone, with a pointer to the
 * board, because nothing verified supports a firmer answer.
 */
export const LICENSE_GUIDE_PHYSICIAN_VERDICTS: Readonly<Record<string, PhysicianVerdict>> = {
    // Full practice (AANP)
    'Alaska': { verdict: 'No.', basis: ['without physician oversight'] },
    'Arizona': { verdict: 'No.', basis: ['all without physician supervision, a collaborative agreement or a transition period'] },
    'Colorado': {
        verdict: 'Not to practice, though new prescribers must complete a prescribing mentorship.',
        basis: ['can practice independently and prescribe', 'new to prescribing', 'must complete a 750 hour prescribing mentorship with a physician or an advanced practice registered nurse'],
    },
    'Connecticut': {
        verdict: 'Yes, for at least the first three years and 2,000 hours of practice.',
        basis: ['to practice in collaboration with a physician for at least three years and 2,000 hours before practicing independently'],
    },
    'Delaware': { verdict: 'No.', basis: ['requires no collaborative agreement or supervised experience period after licensure'] },
    'Maine': {
        verdict: 'Not necessarily a physician, but until new Board of Nursing rules take effect, a supervision or employment requirement applies for at least the first 24 months.',
        basis: [
            'must practice for at least 24 months under the supervision of a licensed physician or a supervising',
            'or be employed by a clinic or hospital whose medical director is a licensed physician',
            'A 2026 law replaces this requirement once the Board of Nursing adopts new practice standards by rule',
        ],
    },
    'Maryland': {
        verdict: 'Not necessarily.',
        basis: ['Applicants who have never been certified as', 'must name a mentor on their application, a physician or'],
    },
    'Massachusetts': {
        verdict: 'Not necessarily a physician. Prescribing is supervised until the required practice experience is attested to the Board of Registration in Nursing.',
        basis: ['who may be a physician or an experienced', 'supervises their prescribing', 'once they attest to the Board of Registration in Nursing'],
    },
    'Minnesota': {
        verdict: 'Not necessarily a physician, but at least the first 2,080 hours of practice are under a collaborative agreement.',
        basis: ['must first practice at least 2,080 hours under a collaborative agreement with a physician or with an advanced practice registered nurse'],
    },
    'Nevada': {
        verdict: 'In some cases.',
        basis: ['may prescribe Schedule II controlled substances only under a protocol approved by a collaborating physician', 'must complete 1,000 hours of supervised practice'],
    },
    'New York': {
        verdict: 'Yes, for the first 3,600 hours of practice.',
        basis: ['with 3,600 hours of practice or fewer must practice in collaboration with a physician', 'with more than 3,600 hours of practice are currently exempt'],
    },
    'South Dakota': {
        verdict: 'Not necessarily a physician, but the first 1,040 hours of licensed practice are under a collaborative agreement.',
        basis: ['need a written collaborative agreement with a physician, certified nurse practitioner or certified nurse midwife', 'until they have completed 1,040 hours of licensed practice'],
    },
    'Vermont': {
        verdict: 'Not necessarily a physician, but a collaborative provider agreement is required until the transition to practice is complete.',
        basis: ['once they complete the transition to practice', 'must have a collaborative provider agreement with a Vermont licensed physician or advanced practice registered nurse'],
    },
    // Reduced practice (AANP)
    'Alabama': { verdict: 'Yes.', basis: ['to practice under a collaborative practice agreement with a physician'] },
    'Arkansas': {
        verdict: 'For prescribing, usually.',
        basis: ['need a collaborative practice agreement, typically with a physician, to prescribe unless they hold a certificate of full independent practice authority'],
    },
    'Illinois': {
        verdict: 'Not always.',
        basis: ['to have a written collaborative agreement until they obtain full practice authority, except when they practice under clinical privileges'],
    },
    'Indiana': { verdict: 'Yes.', basis: ['must practice under a collaborative agreement with a physician'] },
    'Kentucky': {
        verdict: 'For prescribing, at least until four years of prescribing experience; dropping the controlled substance agreement also requires a Board of Nursing good standing review.',
        basis: [
            'need a collaborative agreement with a physician to prescribe',
            'four years of prescribing experience',
            'they may prescribe without these agreements',
            'dropping the controlled substance agreement first requires a Board of Nursing good standing review',
        ],
    },
    'New Jersey': {
        verdict: 'For prescribing and ordering medications and devices, generally yes.',
        basis: ['generally requires', 'to have joint protocols with a collaborating physician in order to prescribe or order medications and devices'],
    },
    'Ohio': { verdict: 'Yes.', basis: ['must have a standard care arrangement with a collaborating physician'] },
    'West Virginia': {
        verdict: 'For prescribing, unless the Board of Registered Nurses has approved removal of that requirement.',
        basis: ['must have a collaborative agreement with a physician to prescribe unless the Board of Registered Nurses has approved removal of that requirement'],
    },
    'Wisconsin': {
        verdict: 'Yes, or a dentist, until the Board of Nursing verifies eligibility for independent practice.',
        basis: ['must practice in collaboration with a physician or dentist until the Board of Nursing verifies that they qualify for independent practice'],
    },
    // Restricted practice (AANP)
    'California': {
        verdict: 'Generally, yes.',
        basis: ['generally practice under standardized procedures developed collaboratively with physicians and furnish drugs and devices under physician supervision'],
    },
    'Florida': {
        verdict: 'Generally, yes.',
        basis: ['to practice under a supervisory protocol with a physician', 'may register for autonomous practice'],
    },
    'Georgia': { verdict: 'Yes.', basis: ['to practice under physician supervision with a protocol agreement'] },
    'Michigan': {
        verdict: 'For controlled substance prescribing, yes.',
        basis: ['may prescribe controlled substances in schedules 2 to 5 only as a delegated act of a physician'],
    },
    'Missouri': { verdict: 'Yes.', basis: ['to have a collaborative practice arrangement with physician supervision'] },
    'North Carolina': { verdict: 'Yes.', basis: ['to practice under physician supervision'] },
    'Oklahoma': {
        verdict: 'For prescribing, until the Board of Nursing grants independent prescriptive authority.',
        basis: ['who prescribe must have a written supervision agreement with a supervising physician until the Board of Nursing grants them independent prescriptive authority'],
    },
    'South Carolina': { verdict: 'Yes.', basis: ['must perform medical acts under a practice agreement with a physician'] },
    'Tennessee': { verdict: 'Yes.', basis: ['requires physician supervision for'] },
    'Texas': { verdict: 'Yes.', basis: ['to have a prescriptive authority agreement with a supervising physician'] },
    'Virginia': {
        verdict: 'Generally, yes.',
        basis: ['must maintain a practice agreement documenting collaboration and consultation with a patient care team physician', 'can apply for a license designation to practice without a practice agreement'],
    },
};

/** The state's audited rule text (the only per-state source these guides use). */
function stateRule(s: LicenseGuideState): string {
    return STATE_PRACTICE_AUTHORITY[s.name].details;
}

/** The state's verdict, or null when its details are published alone. */
function physicianVerdict(s: LicenseGuideState): PhysicianVerdict | null {
    return LICENSE_GUIDE_PHYSICIAN_VERDICTS[s.name] ?? null;
}

/**
 * Board pointer closing each per-state answer. Where no verdict exists,
 * it names what the details leave open (a transition period in a full
 * practice state, the parties to an agreement elsewhere) without claiming
 * either way.
 */
function boardRulePointer(s: LicenseGuideState): string {
    if (physicianVerdict(s)) return `The ${s.boardName} publishes the current rule.`;
    if (s.authority === 'full') {
        return `The ${s.boardName} publishes the current rule, including any requirement that applies to newly licensed ${NP}s.`;
    }
    return /agreement|arrangement|protocol/i.test(stateRule(s))
        ? `The ${s.boardName} publishes the current rule, including who may be a party to the agreement.`
        : `The ${s.boardName} publishes the current rule.`;
}

/**
 * True when the state's rule ties a requirement to time or hours (a
 * transition, a mentorship, an experience route out of an agreement).
 * Read from the details string, never from the tier.
 */
function ruleDependsOnExperience(s: LicenseGuideState): boolean {
    return /\b(hours?|months?|years?)\b/i.test(stateRule(s));
}

/** Quick answer: the AANP tier, then the state's own answer. */
function quickAuthorityAnswer(s: LicenseGuideState): string {
    const tier = `AANP classifies ${s.name} as a ${TIER_NAME[s.authority]} ${jurisdictionKind(s)}.`;
    const verdict = physicianVerdict(s);
    return verdict
        ? `${tier} Do you need a collaborating or supervising physician? ${verdict.verdict} The practice authority section below quotes the full ${s.name} rule.`
        : `${tier} ${stateRule(s)}`;
}

/**
 * The practice authority section above the rule text: AANP's meaning of
 * the tier (attributed and linked) and why same-tier states differ.
 */
function authoritySection(s: LicenseGuideState): string {
    const fpa = STAT_SOURCES.fullPracticeStates;
    const aanp = `[${fpa.source}](${fpa.sourceUrl})`;
    const classification = s.authority === 'full'
        ? `The AANP classifies ${s.name} as a **full practice authority (FPA)** ${jurisdictionKind(s)}, one of ${fpa.formatted} (${aanp}, ${fpa.asOf}).`
        : `The AANP classifies ${s.name} as a **${TIER_NAME[s.authority]}** ${jurisdictionKind(s)} (${aanp}).`;
    return [
        `${classification} ${AANP_TIER_MEANING[s.authority]}`,
        `${TIER_VARIES[s.authority]} The ${s.name} rule quoted below is the one that applies here.`,
    ].join('\n\n');
}

/** Practical close of the section: tier-neutral, true in every state. */
function authorityJobSearchParagraph(s: LicenseGuideState): string {
    const record = ruleDependsOnExperience(s)
        ? `Because the ${s.name} rule ties part of the requirement to time or hours, keep a dated record of your practice hours, settings and any collaborating or supervising providers from your first day; you may need to document them later. `
        : '';
    return `${record}In a job search, read each posting against the ${s.name} rule rather than the AANP tier. When an offer depends on an agreement with a collaborating or supervising physician or another provider, ask who fills that role, whether the arrangement will be in place before your start date, and what happens to it if you change roles.`;
}

/**
 * LIC-L1: the state's own rule text, quoted verbatim from the audited
 * dataset (lib/state-practice-authority.ts). Repo data, not live data, so
 * it lives in the static markdown the sync script mirrors into the DB.
 * Every entry differs, which is what breaks the near-duplicate groups
 * among same-tier guides (spec4 3C). The details are the dataset's own
 * summary of state law, not AANP text, so the sentence does not attribute
 * them to AANP.
 */
export function buildLicenseGuideRuleText(s: LicenseGuideState): string {
    return `The ${s.name} entry in the practice-authority dataset ${brand.name} publishes reads: "${stateRule(s)}" The [${s.boardName}](${s.boardUrl}) holds the current rule text and the forms that go with it.`;
}

/**
 * Source line appended to every compact claim — the as-of date is the
 * real verification date of the two sets above, and the link hands the
 * reader the live roster those sets were checked against.
 */
const NLC_SOURCE_SENTENCE = `Compact status verified against the [live NCSBN roster](${NLC_LIVE_ROSTER_URL}) on ${NLC_VERIFIED_LABEL}; membership shifts as legislatures act, so re-check the roster before relying on it.`;

function nlcSection(s: LicenseGuideState): string {
    if (s.nlcStatus === 'member') {
        return [
            `${s.name} participates in the **Nurse Licensure Compact (NLC)**. The compact applies to the RN license that underpins your APRN credential: if ${s.name} is your primary state of residence, you can hold a multistate RN license that is recognized across compact member states without separate RN endorsements.`,
            `Your APRN license itself is still issued state-by-state. Compact RN privileges do not substitute for ${s.code} APRN licensure, and practicing as an ${NP} in another state still requires that state's APRN credential. Where the compact pays off is mobility: travel and telehealth roles, and any future multi-state practice, start from a simpler RN foundation. Verify your compact eligibility and primary-state-of-residence rules with the [${s.boardName}](${s.boardUrl}). ${NLC_SOURCE_SENTENCE}`,
        ].join('\n\n');
    }
    if (s.nlcStatus === 'pending') {
        return [
            `${s.name} has **enacted the Nurse Licensure Compact but not yet implemented it**. NCSBN lists the implementation date as to-be-determined. Until the ${s.boardName} completes implementation, the compact changes nothing in practice: multistate RN licenses are neither issued to ${s.name} residents nor honored for practice in ${s.code}, so plan on a ${s.name}-issued RN license (typically by endorsement) beneath your APRN application, exactly as in a non-compact state.`,
            `Implementation timing is set by the board and NCSBN, not by this guide. Verify the current status with the [${s.boardName}](${s.boardUrl}) before planning a relocation or telehealth caseload around compact privileges. ${NLC_SOURCE_SENTENCE}`,
        ].join('\n\n');
    }
    return [
        `${s.name} does **not** participate in the Nurse Licensure Compact. Even if you already hold a multistate RN license issued by a compact state, you will need a ${s.name}-issued RN license (typically by endorsement) before or alongside your ${s.code} APRN application. Budget extra lead time for that step if you are relocating or picking up a telehealth caseload covering ${s.code} patients.`,
        `The upside of planning for this early: RN endorsement and APRN licensure can usually be worked in parallel, and employers hiring into ${s.code} are used to the sequence. The [${s.boardName}](${s.boardUrl}) lists the endorsement requirements and current application checklists. ${NLC_SOURCE_SENTENCE}`,
    ].join('\n\n');
}

export interface LicenseGuideStep {
    name: string;
    text: string;
}

/**
 * Application-path steps — ONE array feeds the markdown "How to apply"
 * section, the FAQ answer, and the exported HowTo schema builder, so
 * visible content and structured data can never diverge. Every step must
 * be true in every state it renders for (51 guides, the state hubs and the
 * HowTo graph), so the practice step points the reader to the state's own
 * rule and names no tier-derived requirement.
 */
export function buildLicenseGuideSteps(s: LicenseGuideState): LicenseGuideStep[] {
    const rnStep = s.nlcStatus === 'member'
        ? `Hold an active, unencumbered RN license. Because ${s.name} is a compact state, a multistate RN license (with ${s.name} as your primary state of residence) or ${codeArticle(s.code)} ${s.code} single-state RN license both work as the foundation.`
        : s.nlcStatus === 'pending'
            ? `Hold an active, unencumbered ${s.name} RN license. ${s.name} has enacted the Nurse Licensure Compact but implementation is still pending, so until the board announces an implementation date, out-of-state RNs still apply for ${s.code} RN licensure by endorsement.`
            : `Hold an active, unencumbered ${s.name} RN license. ${s.name} is not a compact state, so out-of-state RNs first apply for ${s.code} RN licensure by endorsement.`;
    // Tier-free and state-rule-first: the step names no agreement, because
    // whether one is required (and with whom) is the state's rule, which the
    // guide quotes in full and the state hub prints beside this list.
    const practiceStep = `Read the ${s.name} practice rule against your own experience and practice setting, confirm with the ${s.boardName} which of its requirements apply to you, and complete any agreement, notice or application that the rule or the board requires before you begin practicing.`;
    return [
        { name: 'Verify your RN license foundation', text: rnStep },
        {
            name: 'Complete an accredited graduate program',
            text: `Earn an MSN or DNP from an accredited ${NP_PROSE} program with the clinical hours your certification track requires.`,
        },
        {
            name: 'Pass national board certification',
            // No per-state certification claim: nothing in repo data verifies
            // which boards require national certification, so the board
            // checklist answers for the state.
            text: `Certify with the body that matches your role: AANP or ANCC for ${NP}s, NBCRNA for CRNAs, AMCB for certified nurse midwives. Most states require current national certification for APRN licensure; the ${s.boardName}'s checklist confirms whether ${s.name} does.`,
        },
        {
            name: `Apply for APRN licensure with the ${s.boardName}`,
            text: `Submit the APRN application with transcripts, any required certification verification, and the fees on the board's current checklist. The board's own checklist is authoritative. Forms, fees, and processing times change, so work directly from the board site.`,
        },
        { name: 'Confirm the practice requirements that apply to you', text: practiceStep },
        {
            name: 'Register for federal identifiers',
            text: `Obtain an NPI number, and register with the DEA if you will prescribe controlled substances. Some states also require a separate state controlled-substance registration; the board checklist will say whether ${s.name} does.`,
        },
    ];
}

export interface LicenseGuideFaq {
    name: string;
    text: string;
}

/**
 * FAQ — ONE array feeds both the visible "Frequently asked questions"
 * markdown section and faq_json (FAQPage JSON-LD emitted by
 * app/blog/[slug]/page.tsx), so schema always matches visible content.
 */
export function buildLicenseGuideFaq(s: LicenseGuideState): LicenseGuideFaq[] {
    const fpa = STAT_SOURCES.fullPracticeStates;
    // The classification answers "does the state have FPA" only in AANP's
    // terms; the state's own rule follows, so a transition period (or a
    // state route to full practice authority, as in Illinois) is never
    // hidden behind the tier.
    const authorityAnswer = s.authority === 'full'
        ? `By AANP's classification, yes. AANP classifies ${s.name} as a full practice ${jurisdictionKind(s)}, one of ${fpa.formatted} (${fpa.source}, ${fpa.asOf}). ${stateRule(s)} ${boardRulePointer(s)}`
        : `Not by AANP's classification. AANP classifies ${s.name} as a ${TIER_NAME[s.authority]} ${jurisdictionKind(s)} rather than a full practice ${jurisdictionKind(s)}. ${stateRule(s)} ${boardRulePointer(s)}`;
    const nlcAnswer = s.nlcStatus === 'member'
        ? `Yes, ${s.name} is a Nurse Licensure Compact member (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). The compact covers the RN license underpinning your APRN credential (a multistate RN license works across member states), but APRN licensure itself is still issued individually by each state, including ${s.name}.`
        : s.nlcStatus === 'pending'
            ? `Not yet. ${s.name} has enacted the Nurse Licensure Compact, but implementation is pending. NCSBN lists the implementation date as to-be-determined (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). Until the ${s.boardName} completes implementation, a multistate RN license is neither issued nor honored in ${s.name}, so you still need a ${s.name}-issued RN license (by endorsement) plus ${s.code} APRN licensure; verify the current status with the board.`
            : `No, ${s.name} is not a Nurse Licensure Compact member (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). Even with a multistate RN license from a compact state, you need a ${s.name}-issued RN license (by endorsement) plus ${s.code} APRN licensure to practice as an ${NP} there.`;
    // Also published as "Do NPs need a collaborating or supervising physician in {state}?"
    // on the setting-by-state pages (lib/pseo/setting-state-template.tsx
    // finds it by the /collaborating or supervising physician/ question
    // name), beside the same details on the Practice Authority card.
    const physicianAnswer = [physicianVerdict(s)?.verdict, stateRule(s), boardRulePointer(s)]
        .filter(Boolean)
        .join(' ');
    return [
        {
            name: `Does ${s.name} have full practice authority for ${NP}s?`,
            text: authorityAnswer,
        },
        {
            name: `Is ${s.name} part of the Nurse Licensure Compact?`,
            text: nlcAnswer,
        },
        {
            name: `What do I need to apply for APRN licensure in ${s.name}?`,
            text: `An active RN license, an MSN or DNP from an accredited program, national certification where the board requires it (AANP or ANCC for ${NP}s; NBCRNA for CRNAs, AMCB for CNMs), and the application on the ${s.boardName}'s current checklist. Fees, forms, and processing times are set by the board and change, so work directly from the board site rather than third-party summaries.`,
        },
        {
            name: `Do I need a collaborating or supervising physician in ${s.name}?`,
            text: physicianAnswer,
        },
        {
            name: `How much do ${NP}s make in ${s.name}?`,
            text: payFaqAnswer(s),
        },
    ];
}

/**
 * Data-free pay answer (spec4 B2): the cited BLS median plus the publishing
 * gate. It never states a state figure, because the static markdown (and
 * the faq_json synced from it) cannot know whether the gate is met.
 */
function payFaqAnswer(s: LicenseGuideState): string {
    return `The national median for ${NP_PROSE}s is ${cite(STAT_SOURCES.averageSalary)}. ${brand.name} publishes a ${s.name} median only when at least ${BENCHMARK_MIN_POSTINGS} postings with disclosed pay from at least ${BENCHMARK_MIN_EMPLOYERS} employers support it. The ${s.name} job market snapshot on this page reports the current ${s.code} figure whenever that gate is met.`;
}

function buildMarkdown(s: LicenseGuideState): string {
    const steps = buildLicenseGuideSteps(s);
    const faqs = buildLicenseGuideFaq(s);
    const stepsMd = steps
        .map((step, i) => `${i + 1}. **${step.name}.** ${step.text}`)
        .join('\n');
    const faqMd = faqs
        .map((f) => `### ${f.name}\n\n${f.text}`)
        .join('\n\n');

    const quickNlc = s.nlcStatus === 'member'
        ? `${s.name} is a Nurse Licensure Compact member, which simplifies the RN layer of your credential.`
        : s.nlcStatus === 'pending'
            ? `${s.name} has enacted the Nurse Licensure Compact but implementation is pending, so for now out-of-state RNs still add an endorsement step.`
            : `${s.name} sits outside the Nurse Licensure Compact, so out-of-state RNs add an endorsement step.`;
    return `**Quick answer:** ${quickAuthorityAnswer(s)} ${quickNlc} Applications, fees, and timelines run through the [${s.boardName}](${s.boardUrl}).

---

## Practice authority in ${s.name}

${authoritySection(s)}

${buildLicenseGuideRuleText(s)}

${authorityJobSearchParagraph(s)}

## The Nurse Licensure Compact and your ${s.code} license

${nlcSection(s)}

## How to apply for ${s.name} APRN licensure

The sequence below is the standard ${s.code} path. Details such as required forms, fees, fingerprinting, and processing times are set by the [${s.boardName}](${s.boardUrl}) and change periodically, so treat the board's current checklist as the source of truth.

${stepsMd}

## Renewing your ${s.name} license

Renewal cycles, continuing-education requirements, and fees are set by the ${s.boardName}. We deliberately do not quote them here because boards revise them and stale numbers are worse than none. Two evergreen rules: keep your national certification current (state renewal typically requires it), and check the [board's renewal checklist](${s.boardUrl}) well before your expiration date so a missing CE item does not lapse your license.

## What ${NP}s earn in ${s.name}

The national median for ${NP_PROSE}s is ${cite(STAT_SOURCES.averageSalary)}, and employment is projected to grow ${STAT_SOURCES.blsGrowth2034.formatted} (${STAT_SOURCES.blsGrowth2034.source}). ${brand.name} publishes a ${s.name} median only when at least ${BENCHMARK_MIN_POSTINGS} postings with disclosed pay from at least ${BENCHMARK_MIN_EMPLOYERS} employers support it. The ${s.name} job market snapshot further down this page reports what is currently posted for ${s.code}, and it links the live ${s.code} listings and the ${s.name} salary guide only when those pages have something to show.

## Frequently asked questions

${faqMd}
`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Meta description, also the HowTo description. It names the AANP tier as
 * a topic, never a tier-derived requirement: "physician-supervision rules"
 * was false for Virginia, and "collaborative-agreement rules" for the
 * reduced practice states with a way out of the agreement.
 */
function metaDescription(s: LicenseGuideState): string {
    const authorityBit = s.authority === 'full' ? 'full practice authority rules' : `${TIER_NAME[s.authority]} rules`;
    return `${s.name} ${NP} licensure guide: ${authorityBit}, Nurse Licensure Compact status, APRN application steps, renewal pointers, and salary data.`;
}

/** Find the state row for a state slug (e.g. 'new-hampshire'), or null. */
export function getLicenseGuideState(stateSlug: string): LicenseGuideState | null {
    return LICENSE_GUIDE_STATES.find((s) => s.stateSlug === stateSlug) ?? null;
}

/** All 51 license-guide blog slugs (np-license-alabama … np-license-wyoming). */
export function getAllLicenseGuideSlugs(): string[] {
    return LICENSE_GUIDE_STATES.map((s) => s.slug);
}

/**
 * Build the full BlogPost object for a state slug — the same shape
 * lib/blog.ts serves from the blog_posts table, so app/blog/[slug]
 * renders it with zero template changes. Returns null for unknown slugs
 * (the caller 404s).
 */
export function getLicenseGuidePost(stateSlug: string): BlogPost | null {
    const s = getLicenseGuideState(stateSlug);
    if (!s) return null;
    return {
        id: `license-guide-${s.stateSlug}`,
        title: `How to Get Your ${NP_LONG} License in ${s.name}`,
        slug: s.slug,
        content: buildMarkdown(s),
        meta_description: metaDescription(s),
        target_keyword: `${s.name.toLowerCase()} ${NP_PROSE} license`,
        category: 'state_spotlight',
        status: 'published',
        publish_date: LICENSE_GUIDE_PUBLISH_DATE,
        image_url: null,
        youtube_video_id: null,
        video_url: null,
        reviewed_at: LICENSE_GUIDE_REVIEWED_AT,
        faq_json: buildLicenseGuideFaq(s),
        created_at: LICENSE_GUIDE_PUBLISH_DATE,
        updated_at: LICENSE_GUIDE_REVIEWED_AT,
    };
}

/**
 * HowTo JSON-LD for a license guide, derived from the SAME steps array
 * rendered in the visible "How to apply" section (LIC-L4).
 *
 * Emitted by app/blog/[slug]/page.tsx inside its LICENSE_GUIDE_SLUG_REGEX
 * branch, escaped through the page's toJsonLd guard. Google no longer
 * shows HowTo rich results, so this is structured context, not a traffic
 * lever. tests/regressions/aeo-content-blog-freshness.test.ts pins that the
 * page never builds a HowTo inline: this builder is the only source.
 */
export function buildLicenseGuideHowTo(stateSlug: string): object | null {
    const s = getLicenseGuideState(stateSlug);
    if (!s) return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `How to Get Your ${NP_LONG} License in ${s.name}`,
        description: metaDescription(s),
        step: buildLicenseGuideSteps(s).map((step, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: step.name,
            text: step.text,
        })),
    };
}

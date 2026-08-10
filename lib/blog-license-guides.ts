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
 *   - NLC status: LICENSE_GUIDE_NLC_NON_MEMBERS +
 *     LICENSE_GUIDE_NLC_ENACTED_PENDING below — mirror the canonical sets
 *     in lib/pseo/state-narrative.ts (kept in sync by the drift test in
 *     tests/regressions/p1-content-library-license-guides.test.ts),
 *     verified against the live NCSBN roster on NLC_ROSTER_VERIFIED_AT.
 *   - Salary / growth figures: lib/stats-sources.ts, cited inline. Live
 *     state-level numbers are LINKED (/salary-guide/<state>), never
 *     restated here.
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
import type { BlogPost } from './blog';

// ─── Editorial dates (real, fixed — never render-time; audit B54) ───────────

/** Date the series content + data sources were authored/verified. Bump on
 *  each editorial review pass (feeds reviewed_at → BlogPosting.dateModified). */
export const LICENSE_GUIDE_REVIEWED_AT = '2026-07-29T00:00:00.000Z';
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

function authorityIntroPhrase(s: LicenseGuideState): string {
    switch (s.authority) {
        case 'full':
            return `${s.name} is a full practice authority state, so the licensure path here ends with independent practice — no collaborating or supervising physician required`;
        case 'reduced':
            return `${s.name} is a reduced practice state, so plan for one extra step most full-practice states skip: a collaborative agreement with a physician`;
        case 'restricted':
            return `${s.name} is a restricted practice state, so physician supervision is built into how ${NP}s practice here — and into the paperwork you'll file`;
    }
}

function authoritySection(s: LicenseGuideState): string {
    switch (s.authority) {
        case 'full':
            return [
                `The AANP classifies ${s.name} as a **full practice authority (FPA)** state — one of ${STAT_SOURCES.fullPracticeStates.formatted} (${STAT_SOURCES.fullPracticeStates.source}, ${STAT_SOURCES.fullPracticeStates.asOf}). Under FPA, ${NP_PROSE}s evaluate patients, diagnose, order and interpret tests, and initiate and manage treatment — including prescribing — under the licensure authority of the state board of nursing, without a mandated physician relationship.`,
                `You'll feel the difference in the ${s.code} job market: postings rarely name a collaborating physician, ${NP}-owned practices are a realistic path, and telehealth employers often prioritize clinicians licensed in FPA states. One caveat: some full-practice states phase authority in through a transition-to-practice period after initial licensure, so confirm the current rule with the [${s.boardName}](${s.boardUrl}) before assuming day-one independence.`,
            ].join('\n\n');
        case 'reduced':
            return [
                `The AANP classifies ${s.name} as a **reduced practice** state. You hold your own APRN license, but state law requires a collaborative agreement with a physician covering at least one element of ${NP_PROSE} practice — most commonly prescriptive authority. The agreement is a filed, documented relationship, not day-to-day on-site oversight.`,
                `Practically, that means employed roles in ${s.code} usually come with collaboration built in — hospitals and group practices maintain the agreements — while independent or practice-ownership routes require you to arrange (and often pay for) a collaborating physician yourself. The required contents of the agreement and any filing steps are defined by the [${s.boardName}](${s.boardUrl}); review the current rules there rather than relying on a colleague's older paperwork.`,
            ].join('\n\n');
        case 'restricted':
            return [
                `The AANP classifies ${s.name} as a **restricted practice** state: state law requires supervision, delegation, or team management by a physician for at least one element of ${NP_PROSE} practice. Expect ${s.code} job postings to name a supervising physician, reference protocols or practice agreements, and describe chart-review or delegation arrangements — that language reflects the licensure framework, not an individual employer's preference.`,
                `Restricted does not mean unlicensed autonomy is the only difference — it shapes credentialing, prescriptive authority paperwork, and how quickly you can change practice settings, since supervision arrangements typically must be updated when you move. The [${s.boardName}](${s.boardUrl}) publishes the supervision and delegation requirements that apply; legislative changes in restricted states are frequent enough that the board page is the only current source worth trusting.`,
            ].join('\n\n');
    }
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
            `${s.name} participates in the **Nurse Licensure Compact (NLC)**. The compact applies to the RN license that underpins your APRN credential: if ${s.name} is your primary state of residence, you can hold a multistate RN license that's recognized across compact member states without separate RN endorsements.`,
            `Your APRN license itself is still issued state-by-state — compact RN privileges don't substitute for ${s.code} APRN licensure, and practicing as an ${NP} in another state still requires that state's APRN credential. Where the compact pays off is mobility: travel and telehealth roles, and any future multi-state practice, start from a simpler RN foundation. Verify your compact eligibility and primary-state-of-residence rules with the [${s.boardName}](${s.boardUrl}). ${NLC_SOURCE_SENTENCE}`,
        ].join('\n\n');
    }
    if (s.nlcStatus === 'pending') {
        return [
            `${s.name} has **enacted the Nurse Licensure Compact but not yet implemented it** — NCSBN lists the implementation date as to-be-determined. Until the ${s.boardName} completes implementation, the compact changes nothing in practice: multistate RN licenses are neither issued to ${s.name} residents nor honored for practice in ${s.code}, so plan on a ${s.name}-issued RN license (typically by endorsement) beneath your APRN application, exactly as in a non-compact state.`,
            `Implementation timing is set by the board and NCSBN, not by this guide — verify the current status with the [${s.boardName}](${s.boardUrl}) before planning a relocation or telehealth caseload around compact privileges. ${NLC_SOURCE_SENTENCE}`,
        ].join('\n\n');
    }
    return [
        `${s.name} does **not** participate in the Nurse Licensure Compact. Even if you already hold a multistate RN license issued by a compact state, you'll need a ${s.name}-issued RN license (typically by endorsement) before or alongside your ${s.code} APRN application — budget extra lead time for that step if you're relocating or picking up a telehealth caseload covering ${s.code} patients.`,
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
 * visible content and structured data can never diverge.
 */
export function buildLicenseGuideSteps(s: LicenseGuideState): LicenseGuideStep[] {
    const rnStep = s.nlcStatus === 'member'
        ? `Hold an active, unencumbered RN license. Because ${s.name} is a compact state, a multistate RN license (with ${s.name} as your primary state of residence) or ${codeArticle(s.code)} ${s.code} single-state RN license both work as the foundation.`
        : s.nlcStatus === 'pending'
            ? `Hold an active, unencumbered ${s.name} RN license. ${s.name} has enacted the Nurse Licensure Compact but implementation is still pending, so until the board announces an implementation date, out-of-state RNs still apply for ${s.code} RN licensure by endorsement.`
            : `Hold an active, unencumbered ${s.name} RN license. ${s.name} is not a compact state, so out-of-state RNs first apply for ${s.code} RN licensure by endorsement.`;
    const prescriptiveStep =
        s.authority === 'full'
            ? `Complete any prescriptive-authority or transition-to-practice requirements. In a full-practice state these are handled through the board itself — no collaborative or supervisory agreement is required.`
            : s.authority === 'reduced'
                ? `Establish and document your collaborative agreement with a physician, and file it as the board requires — in ${s.name} this is part of practicing, not optional paperwork.`
                : `Establish your supervision or delegation arrangement with a physician and submit the practice-agreement documentation the board requires before beginning practice.`;
    return [
        { name: 'Verify your RN license foundation', text: rnStep },
        {
            name: 'Complete an accredited graduate program',
            text: `Earn an MSN or DNP from an accredited ${NP_PROSE} program with the clinical hours your certification track requires.`,
        },
        {
            name: 'Pass national board certification',
            text: `Certify with the body that matches your role: AANP or ANCC for ${NP}s, NBCRNA for CRNAs, AMCB for certified nurse midwives. ${s.name} requires current national certification for APRN licensure.`,
        },
        {
            name: `Apply for APRN licensure with the ${s.boardName}`,
            text: `Submit the APRN application with transcripts, certification verification, and the fees on the board's current checklist. The board's own checklist is authoritative — forms, fees, and processing times change, so work directly from the board site.`,
        },
        { name: 'Secure your practice-authority paperwork', text: prescriptiveStep },
        {
            name: 'Register for federal identifiers',
            text: `Obtain an NPI number, and register with the DEA if you'll prescribe controlled substances. Some states also require a separate state controlled-substance registration — the board checklist will say whether ${s.name} does.`,
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
    const authorityAnswer =
        s.authority === 'full'
            ? `Yes. The AANP classifies ${s.name} as a full practice authority state — one of ${STAT_SOURCES.fullPracticeStates.formatted} — so ${NP_PROSE}s can practice and prescribe without a required physician relationship. Some full-practice states apply a transition-to-practice period after initial licensure; the ${s.boardName} publishes the current requirement.`
            : s.authority === 'reduced'
                ? `No. The AANP classifies ${s.name} as a reduced practice state: ${NP_PROSE}s must maintain a collaborative agreement with a physician covering at least one element of practice, most commonly prescribing. The ${s.boardName} defines what the agreement must contain.`
                : `No. The AANP classifies ${s.name} as a restricted practice state: physician supervision, delegation, or team management is required for ${NP_PROSE} practice. The ${s.boardName} publishes the supervision and practice-agreement requirements.`;
    const nlcAnswer = s.nlcStatus === 'member'
        ? `Yes, ${s.name} is a Nurse Licensure Compact member (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). The compact covers the RN license underpinning your APRN credential — a multistate RN license works across member states — but APRN licensure itself is still issued individually by each state, including ${s.name}.`
        : s.nlcStatus === 'pending'
            ? `Not yet. ${s.name} has enacted the Nurse Licensure Compact, but implementation is pending — NCSBN lists the implementation date as to-be-determined (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). Until the ${s.boardName} completes implementation, a multistate RN license is neither issued nor honored in ${s.name}, so you still need a ${s.name}-issued RN license (by endorsement) plus ${s.code} APRN licensure; verify the current status with the board.`
            : `No, ${s.name} is not a Nurse Licensure Compact member (verified against the live NCSBN roster, ${NLC_VERIFIED_LABEL}). Even with a multistate RN license from a compact state, you need a ${s.name}-issued RN license (by endorsement) plus ${s.code} APRN licensure to practice as an ${NP} there.`;
    const physicianAnswer =
        s.authority === 'full'
            ? `No collaborative or supervising physician is required in ${s.name} — it's a full practice authority state. Confirm any transition-to-practice conditions with the ${s.boardName}.`
            : s.authority === 'reduced'
                ? `Yes — ${s.name} requires a documented collaborative agreement with a physician. Employed roles usually have this arranged by the employer; independent practice means arranging your own collaborator per the ${s.boardName}'s rules.`
                : `Yes — ${s.name} requires physician supervision or delegation for ${NP_PROSE} practice, documented in the practice-agreement paperwork the ${s.boardName} requires.`;
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
            text: `An active RN license, an MSN or DNP from an accredited program, national certification (AANP or ANCC for ${NP}s; NBCRNA for CRNAs, AMCB for CNMs), and the application on the ${s.boardName}'s current checklist. Fees, forms, and processing times are set by the board and change — work directly from the board site rather than third-party summaries.`,
        },
        {
            name: `Do I need a collaborating or supervising physician in ${s.name}?`,
            text: physicianAnswer,
        },
        {
            name: `How much do ${NP}s make in ${s.name}?`,
            text: `The national median for ${NP_PROSE}s is ${cite(STAT_SOURCES.averageSalary)}. State-level pay varies with cost of living and practice setting — the ${s.name} salary guide on ${brand.name} shows live averages and ranges computed from current ${s.code} postings.`,
        },
    ];
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
    return `**Quick answer:** ${authorityIntroPhrase(s)}. ${quickNlc} Applications, fees, and timelines run through the [${s.boardName}](${s.boardUrl}).

---

## Practice authority in ${s.name}

${authoritySection(s)}

## The Nurse Licensure Compact and your ${s.code} license

${nlcSection(s)}

## How to apply for ${s.name} APRN licensure

The sequence below is the standard ${s.code} path. Details — required forms, fees, fingerprinting, and processing times — are set by the [${s.boardName}](${s.boardUrl}) and change periodically, so treat the board's current checklist as the source of truth.

${stepsMd}

## Renewing your ${s.name} license

Renewal cycles, continuing-education requirements, and fees are set by the ${s.boardName} — we deliberately don't quote them here because boards revise them and stale numbers are worse than none. Two evergreen rules: keep your national certification current (state renewal typically requires it), and check the [board's renewal checklist](${s.boardUrl}) well before your expiration date so a missing CE item doesn't lapse your license.

## What ${NP}s earn in ${s.name}

The national median for ${NP_PROSE}s is ${cite(STAT_SOURCES.averageSalary)}, and employment is projected to grow ${STAT_SOURCES.blsGrowth2032.formatted} (${STAT_SOURCES.blsGrowth2032.source}). For live ${s.name} numbers — average pay, reported ranges, top employers, and pay by practice setting computed from current postings — see the [${s.name} salary guide](/salary-guide/${s.stateSlug}) and browse [open ${s.code} positions](/jobs/state/${s.stateSlug}).

## Frequently asked questions

${faqMd}
`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

function metaDescription(s: LicenseGuideState): string {
    const authorityBit =
        s.authority === 'full'
            ? 'full practice authority'
            : s.authority === 'reduced'
                ? 'collaborative-agreement rules'
                : 'physician-supervision rules';
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
 * rendered in the visible "How to apply" section.
 *
 * NOT yet emitted: app/blog/[slug]/page.tsx (owned by the E-E-A-T
 * workstream) must add, inside its LICENSE_GUIDE_SLUG_REGEX branch:
 *   const howTo = buildLicenseGuideHowTo(stateSlugFromBlog);
 *   {howTo && <script type="application/ld+json" ... JSON.stringify(howTo)
 *     .replace(/</g, '\\u003c').replace(/>/g, '\\u003e') ... />}
 * (and tests/regressions/aeo-content-blog-freshness.test.ts B45 "no HowTo"
 * assertions must be updated to allow the license-branch HowTo).
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

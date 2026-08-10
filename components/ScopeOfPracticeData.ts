/**
 * Scope-of-practice hub — data assembly (P5 sop-hub).
 *
 * Single source for everything /scope-of-practice renders. TRUTH RULES:
 *
 *   - Practice authority (full / reduced / restricted), the per-state
 *     details sentence, and the tier labels come VERBATIM from
 *     lib/state-practice-authority.ts (AANP State Practice Environment) —
 *     the same dataset behind /resources/fpa-guide, the /jobs/state hubs,
 *     and the licensure checker. Nothing is re-classified here.
 *   - Board names + board links come from lib/blog-license-guides.ts
 *     (LICENSE_GUIDE_STATES), whose 51 NCSBN member-board names and URLs
 *     were verified live on 2026-07-29 (see that file's provenance notes).
 *   - The full-practice count is cross-checked against
 *     STAT_SOURCES.fullPracticeStates by the regression test — the hub can
 *     never disagree with the "27 states + DC" figure cited on /jobs,
 *     /faq, and /salary-guide.
 *   - Dimensions this repo does NOT store (prescribing schedules,
 *     collaboration-agreement contents, fees, hours, renewal rules) are
 *     never asserted: every state row links its board of nursing and the
 *     AANP state-practice-environment page instead.
 *
 *   - NLC status comes from lib/blog-license-guides.ts (`nlcStatus` on
 *     LICENSE_GUIDE_STATES), whose non-member and enacted-pending sets
 *     were corrected and verified against the live NCSBN roster on
 *     NLC_ROSTER_VERIFIED_AT (2026-08-11) — the staleness this hub
 *     previously embargoed (CT/RI/WA wrongly listed as non-members,
 *     Alaska missing) is fixed at its source, so the hub now renders the
 *     tri-state status: member / enacted, implementation pending /
 *     not a member. Enacted-pending states (Massachusetts) are NEVER
 *     collapsed into member or non-member — the label says
 *     implementation is pending and the section copy hands the reader
 *     the live roster and the state board for the current status. No
 *     implementation dates are asserted for pending states (NCSBN lists
 *     them as to-be-determined).
 */
import { brand } from '@/config/brand';
import {
    STATE_PRACTICE_AUTHORITY,
    type PracticeAuthority,
} from '@/lib/state-practice-authority';
import {
    LICENSE_GUIDE_STATES,
    NLC_LIVE_ROSTER_URL,
    NLC_ROSTER_VERIFIED_AT,
    type NlcStatus,
} from '@/lib/blog-license-guides';
import { LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';
import { STAT_SOURCES } from '@/lib/stats-sources';

// ─── Editorial dates (real literals — never render-time; audit B54) ─────────

/**
 * Date this hub's content and sources were last reviewed by a human.
 * Bump on each editorial pass — at minimum whenever
 * lib/state-practice-authority.ts changes or a legislature acts.
 * Feeds the visible "Last reviewed" line AND Article.dateModified, so the
 * page can never claim freshness its schema contradicts.
 */
export const SOP_LAST_REVIEWED = '2026-08-11';

/** First publish date of /scope-of-practice (fixed literal). */
export const SOP_PUBLISHED_AT = '2026-08-06';

// ─── External authorities (the ONLY external links the hub emits) ───────────

/** AANP's live classification page — the source of the three-tier model. */
export const AANP_STATE_PRACTICE_URL = STAT_SOURCES.fullPracticeStates.sourceUrl;

/** Human-readable source line rendered under the "Last reviewed" date. */
export const SOP_SOURCE_LINE = `${STAT_SOURCES.fullPracticeStates.source} (as of ${STAT_SOURCES.fullPracticeStates.asOf})`;

/**
 * Live NLC roster — where every compact claim on this hub points (same
 * URL as /resources/fpa-guide). Canonical constant lives beside the NLC
 * sets in lib/blog-license-guides.ts; re-exported so the page keeps a
 * single import surface.
 */
export { NLC_LIVE_ROSTER_URL, NLC_ROSTER_VERIFIED_AT, type NlcStatus };

/** Human-readable badge labels for the tri-state compact status. */
export const NLC_STATUS_LABELS: Record<NlcStatus, string> = {
    'member': 'Member',
    'pending': 'Enacted — implementation pending',
    'non-member': 'Not a member',
} as const;

/** Source line rendered wherever the hub makes a compact-status claim. */
export const NLC_SOURCE_LINE = `NCSBN Nurse Licensure Compact roster (nursecompact.com), verified ${NLC_ROSTER_VERIFIED_AT}`;

// ─── Per-state rows ─────────────────────────────────────────────────────────

export interface SopStateRow {
    /** Full jurisdiction name, e.g. 'New Hampshire'. */
    name: string;
    /** Postal code, e.g. 'NH'. */
    code: string;
    /** URL slug shared with /jobs/state and /salary-guide, e.g. 'new-hampshire'. */
    stateSlug: string;
    /** In-page deep-anchor id on /scope-of-practice (equals stateSlug). */
    anchorId: string;
    /** AANP practice-authority tier. */
    authority: PracticeAuthority;
    /** Tier display label from the dataset ('Full Practice Authority', …). */
    authorityLabel: string;
    /** The dataset's per-state details sentence, published verbatim. */
    details: string;
    /**
     * Nurse Licensure Compact status from the corrected canonical sets
     * (member / enacted-pending-implementation / non-member) — verified
     * against the live NCSBN roster on NLC_ROSTER_VERIFIED_AT.
     */
    nlcStatus: NlcStatus;
    /** Board of nursing display name (NCSBN directory naming). */
    boardName: string;
    /** NCSBN member-board directory page for the state board. */
    boardUrl: string;
    /** Licensure-guide link — null while the series gate is off (no 404s). */
    licenseGuideHref: string | null;
    /** Live state salary page. */
    salaryHref: string;
    /** State job hub. */
    jobsHref: string;
}

/**
 * All 51 jurisdictions, alphabetical. LICENSE_GUIDE_STATES is itself
 * derived from STATE_PRACTICE_AUTHORITY, so the two joins below cannot
 * disagree on the state list.
 */
export const SOP_STATE_ROWS: ReadonlyArray<SopStateRow> = LICENSE_GUIDE_STATES.map(
    (s) => {
        const info = STATE_PRACTICE_AUTHORITY[s.name];
        return {
            name: s.name,
            code: s.code,
            stateSlug: s.stateSlug,
            anchorId: s.stateSlug,
            authority: info.authority,
            authorityLabel: info.description,
            details: info.details,
            nlcStatus: s.nlcStatus,
            boardName: s.boardName,
            boardUrl: s.boardUrl,
            licenseGuideHref: LICENSE_GUIDE_SERIES_PUBLISHED ? `/blog/${s.slug}` : null,
            salaryHref: `/salary-guide/${s.stateSlug}`,
            jobsHref: `/jobs/state/${s.stateSlug}`,
        };
    },
);

// ─── Tier counts ────────────────────────────────────────────────────────────

/**
 * D.C. is a jurisdiction in the dataset, not a state. The full-tier count
 * is rendered as "<n> states + DC" everywhere on this board (see the
 * fullStateCount correction in app/resources/fpa-guide/page.tsx), so the
 * `full` figure here excludes D.C. — it must equal
 * STAT_SOURCES.fullPracticeStates.value (pinned by the regression test).
 */
export const SOP_COUNTS = {
    full: SOP_STATE_ROWS.filter(
        (r) => r.authority === 'full' && r.name !== 'District of Columbia',
    ).length,
    reduced: SOP_STATE_ROWS.filter((r) => r.authority === 'reduced').length,
    restricted: SOP_STATE_ROWS.filter((r) => r.authority === 'restricted').length,
    total: SOP_STATE_ROWS.length,
} as const;

// ─── FAQ (one array → visible FAQ section AND FAQPage JSON-LD) ──────────────

export interface SopFaq {
    question: string;
    answer: string;
}

/**
 * Answers restate only what the practice-authority dataset and
 * stats-sources support; everything else points at the state board, the
 * AANP page, or the live NCSBN compact roster.
 */
export function buildSopFaqs(): SopFaq[] {
    const NP = brand.niche.short;
    const descriptor = brand.niche.descriptor;
    return [
        {
            question: `What does "scope of practice" mean for ${NP}s?`,
            answer: `Scope of practice is what a state's law and board rules let a ${descriptor} do — evaluate patients, diagnose, order and interpret tests, and initiate and manage treatment, including prescribing. The AANP classifies each state's regulatory environment into one of three tiers: Full Practice (independent practice under the board of nursing), Reduced Practice (a collaborative agreement with a physician is required for at least one element of practice), and Restricted Practice (supervision, delegation, or team management by a physician is required).`,
        },
        {
            question: `How many states grant ${NP}s full practice authority?`,
            answer: `${SOP_COUNTS.full} states plus Washington D.C. are classified as Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}, ${STAT_SOURCES.fullPracticeStates.asOf}). ${SOP_COUNTS.reduced} states are Reduced Practice and ${SOP_COUNTS.restricted} are Restricted Practice. Classifications move whenever a state legislature acts, so confirm the current tier against the AANP State Practice Environment page before relying on one.`,
        },
        {
            question: 'What is the difference between reduced and restricted practice?',
            answer: `In a Reduced Practice state, a ${descriptor} holds their own license but state law requires a documented collaborative agreement with a physician covering at least one element of practice — most commonly prescribing. In a Restricted Practice state, the law goes further: supervision, delegation, or team management by a physician is required for practice itself, and job postings typically name a supervising physician and reference protocols. Several states also apply transition-to-practice periods before full autonomy — the per-state details on this page note the ones in this dataset.`,
        },
        {
            question: `Where do I find my state's prescribing rules and agreement paperwork?`,
            answer: `From your state board of nursing — that is deliberate, not an omission. Controlled-substance schedules, collaboration-agreement contents, filing steps, fees, and renewal rules are set by each board and change often enough that restating them here would go stale. Every state section on this page links the board's NCSBN member-board directory entry, and the AANP State Practice Environment page tracks classification changes as legislatures act.`,
        },
        {
            question: `Does the Nurse Licensure Compact change an ${NP}'s scope of practice?`,
            answer: `No. The compact covers the RN license underpinning your APRN credential — a multistate RN license is recognized across member states — but APRN licensure, and with it your scope of practice, is issued state by state. The table on this page marks each jurisdiction's compact status — member, enacted with implementation pending, or not a member — verified against the live NCSBN roster on ${NLC_ROSTER_VERIFIED_AT}. In enacted-pending states the compact confers nothing yet: no implementation date is set, so verify the current status with the state board. Membership shifts as legislatures act, so re-check the live roster at ${NLC_LIVE_ROSTER_URL} for each state you plan to cover.`,
        },
    ];
}

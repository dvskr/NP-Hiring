/**
 * State Narrative: deterministic per-(setting, state) content snippets.
 *
 * Mirrors the city-narrative pattern at lib/pseo/city-narrative.ts so every
 * indexable /jobs/{setting}/{state} page gets a substantively unique short
 * paragraph driven by structured facts. Two state pages with the same
 * (setting, state) pair read the same; any other pair produces measurably
 * different prose because the fact mix differs.
 *
 * TRUTH RULES (pSEO truth sweep, PLAN.md T0-4, thin-spec 1 T6 to T8): no
 * pay figure, cost-of-living index, demand tier, shortage designation, or
 * compact claim is composed here. Practice authority comes from
 * lib/state-practice-authority.ts, compact status from
 * lib/pseo/practice-environment.ts, and the only number is the live
 * posting count the caller passes in. Professional English, no dashes.
 *
 * Also exports buildPlainStateNarrative, the same idea for the 51 plain
 * /jobs/state/[state] hubs (see the section at the bottom of this file).
 */
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';
import { getCategoryAxis } from './category-axis-guide';
import { getPracticeEnvironment, nlcSentence } from './practice-environment';
import {
    getStatePracticeAuthority,
    PracticeAuthority,
} from '@/lib/state-practice-authority';

// ─── Phrase fragments ───────────────────────────────────────────────────────

const AUTHORITY_PHRASES: Record<PracticeAuthority, string> = {
    full: 'full practice authority, meaning independent prescribing without physician oversight',
    reduced: 'reduced practice authority requiring a collaborative agreement with a physician',
    restricted: 'restricted practice authority requiring physician supervision',
};

// ─── NLC (Nurse Licensure Compact) roster mirrors ───────────────────────────
// The compact lets RNs hold one multistate license valid across member states
// (the RN layer only, never the APRN license itself). The read model for every
// compact sentence is lib/pseo/practice-environment.ts, which derives status
// from LICENSE_GUIDE_STATES in lib/blog-license-guides.ts; nothing in this
// file reads the two sets below. They stay as the reference literals that
// tests/regressions/p1-content-library-license-guides.test.ts extracts from
// this file's source to guard the license-guide mirror against drift, and
// W4-INTEGRATE deletes them together with that extractor.
//
// Verified against the live NCSBN roster (nursecompact.com implementation
// table) on 2026-08-11, the same date as NLC_ROSTER_VERIFIED_AT in
// lib/blog-license-guides.ts.

/** No enacted compact legislation: a separate state license is required. */
export const NLC_NON_MEMBER_STATES: ReadonlySet<string> = new Set([
    'Alaska', 'California', 'District of Columbia', 'Hawaii', 'Illinois',
    'Michigan', 'Minnesota', 'Nevada', 'New York', 'Oregon',
]);

/** Enacted the compact but not yet implemented it (NCSBN date to be determined). */
export const NLC_ENACTED_PENDING_STATES: ReadonlySet<string> = new Set([
    'Massachusetts',
]);

// ─── Setting-specific lead phrases ──────────────────────────────────────────
// One per SETTING_CONFIGS key. Each lead says what the category means on this
// board and what to check in a listing; it never states a figure, a market
// size, or a compact claim (compact status renders once, in the licensure
// section the template builds from practice-environment.ts).

interface StateCtx {
    stateName: string;
    stateCode: string;
}

type SettingLeadFn = (ctx: StateCtx) => string;

const NP = brand.niche.short;

const SETTING_LEADS: Record<string, SettingLeadFn> = {
    'remote': (c) => `Remote ${NP} listings for ${c.stateName} are roles the employer marks as remote, usually with a requirement to hold ${c.stateCode} licensure to treat patients located there. Check each listing for technology, schedule, and licensure expectations, because employers describe remote work differently.`,
    'telehealth': (c) => `Telehealth ${NP} listings for ${c.stateName} describe care delivered by video or phone, and each names the platform, the visit model, and the state licensure it requires. Read the scheduling and documentation expectations closely; telehealth employers structure both in their own way.`,
    'inpatient': (c) => `Inpatient ${NP} listings for ${c.stateName} come from hospitals and hospital-based services, where the posting names the unit, the shift pattern, and any differentials. Credentialing and privileging at the facility define the day-to-day scope, so ask about both timelines early.`,
    'outpatient': (c) => `Outpatient ${NP} listings for ${c.stateName} come from clinics, group practices, and community health centers. Panel size, visit length, and documentation time vary by practice, so confirm each before comparing offers.`,
    'travel': (c) => `Travel ${NP} listings for ${c.stateName} are assignments with a stated length, usually arranged through a staffing agency. Compare the full package, including housing and travel terms, and confirm the ${c.stateName} licensure timeline with the agency before accepting a start date.`,
    'full-time': (c) => `Full-time ${NP} listings for ${c.stateName} are permanent roles where benefits, paid time off, and continuing education support are part of the offer. Compare the whole package rather than base pay alone, and confirm on-call expectations in writing.`,
    'part-time': (c) => `Part-time ${NP} listings for ${c.stateName} state a reduced weekly schedule on a fixed basis, distinct from as-needed shifts. Ask where the benefits eligibility threshold sits and whether the role can expand to full-time.`,
    'contract': (c) => `Contract ${NP} listings for ${c.stateName} are fixed-term engagements, either as an agency W-2 employee or as an independent contractor. The structure decides who handles taxes, malpractice, and benefits, so confirm it before you compare the rate to a permanent offer.`,
    'new-grad': (c) => `New-graduate ${NP} listings for ${c.stateName} say the employer is open to clinicians who are newly certified, and the better ones spell out onboarding, preceptorship, and supervision. Ask how the caseload ramps and who provides clinical backup during the first months.`,
    '1099': (c) => `Independent-contractor (1099) ${NP} listings for ${c.stateName} quote a rate before self-employment tax, malpractice, and the benefits you fund yourself. Model the after-tax figure, and confirm who holds any collaborative agreement ${c.stateName} requires before signing.`,
    'per-diem': (c) => `Per-diem ${NP} listings for ${c.stateName} are as-needed shifts without guaranteed hours, credentialed facility by facility. Keep licensure and certification paperwork current, and clarify cancellation terms and any weekend or holiday differentials up front.`,
    'locum-tenens': (c) => `Locum tenens ${NP} listings for ${c.stateName} cover a practice or facility for a defined period, usually through an agency that handles scheduling and credentialing paperwork. Each assignment still requires ${c.stateName} APRN licensure, so confirm the licensing timeline before the start date.`,
    'family-practice': (c) => `Family practice ${NP} (FNP) listings for ${c.stateName} cover primary care across the lifespan, from group practices to rural health clinics. Check each listing for panel size, walk-in coverage, and the collaboration terms ${c.stateName} applies.`,
    'adult-gerontology': (c) => `Adult-gerontology ${NP} listings for ${c.stateName} split between the primary care track (AGPCNP) in clinics and long-term care and the acute care track (AGACNP) in hospital services. Match the listing's certification requirement to your own track before applying.`,
    'pediatric': (c) => `Pediatric ${NP} listings for ${c.stateName} span primary-care pediatrics, school-based programs, and children's hospital services. Confirm the acuity mix and any after-hours nurse-line or call expectations in each listing.`,
    'women-health': (c) => `Women's health ${NP} (WHNP) listings for ${c.stateName} sit in OB/GYN groups, family-planning programs, and prenatal clinics. Confirm whether the scope is gynecology only or includes prenatal and postpartum panels, and whether obstetric call is expected.`,
    'acute-care': (c) => `Acute care ${NP} listings for ${c.stateName} come from ICUs, step-down units, and hospital specialty services. Listings name the shift pattern and differentials; orientation length and procedure training are worth asking about before comparing offers.`,
    'emergency': (c) => `Emergency ${NP} listings for ${c.stateName} staff emergency departments and fast-track units on shift schedules. Ask which procedures ${NP}s own in that department, how the day and overnight mix works, and what prior experience the employer expects.`,
    'anesthesia': (c) => `CRNA listings for ${c.stateName} come from hospital operating rooms, surgery centers, and procedural suites, and each states whether the practice model is independent, care-team, or supervised. Call burden and post-call time change what an offer is worth, so compare them alongside the rate. CRNA supervision rules in ${c.stateName} are set by state law and facility policy, separate from ${NP} practice authority.`,
    'midwifery': (c) => `Certified nurse midwife (CNM) listings for ${c.stateName} cover hospital labor-and-delivery services, birth centers, and OB/GYN practices. Ask about call frequency, backup arrangements, and expected birth volume; CNM practice rules in ${c.stateName} are set separately from ${NP} practice authority.`,
    'primary-care': (c) => `Primary care ${NP} listings for ${c.stateName} come from internal-medicine groups, family practices, community health centers, and value-based care organizations. Panel size, documentation time, and quality-incentive structure are the practical differences to compare between offers.`,
    'oncology': (c) => `Oncology ${NP} listings for ${c.stateName} come from cancer centers, hematology-oncology groups, and infusion clinics. Confirm the treatment-phase focus, whether active treatment, infusion oversight, or survivorship, and what oncology-specific training the employer provides.`,
    'cardiology': (c) => `Cardiology ${NP} listings for ${c.stateName} split between clinic work, such as heart-failure and device clinics, and inpatient consult services. Hybrid roles name their call and weekend expectations, so read the schedule section before comparing pay.`,
    'hospitalist': (c) => `Hospitalist ${NP} listings for ${c.stateName} run on block schedules covering admissions, rounding, and cross-cover. Clarify the night-shift share of each block and the expected census per shift before signing.`,
    'dermatology': (c) => `Dermatology ${NP} listings for ${c.stateName} pair medical dermatology with procedural clinic work, and many add cosmetic services. Confirm the medical-to-cosmetic mix and how productivity bonuses are calculated in each practice.`,
    'urgent-care': (c) => `Urgent care ${NP} listings for ${c.stateName} run on defined shifts with no patient panel to carry between them. Clarify the evening, weekend, and holiday rotation and the procedures ${NP}s own at that site.`,
    'home-health': (c) => `Home health ${NP} listings for ${c.stateName} put clinicians on the road for house calls, transitional-care visits, and annual wellness assessments. Territory size, daily visit expectations, and mileage terms change effective pay, so confirm all three.`,
    // Keyed via the registry-derived constant so the specialty slug literal
    // stays confined to taxonomy-registry.ts (niche-copy debt ratchet).
    ...(PSYCH_SPECIALTY_SLUG
        ? {
            [PSYCH_SPECIALTY_SLUG]: ((c) => `Behavioral-health ${NP} listings for ${c.stateName} span outpatient clinics, telehealth platforms, and integrated care settings. Clarify the caseload mix between medication management and therapy time, and the controlled-substance prescribing workflow ${c.stateName} requires.`) as SettingLeadFn,
        }
        : {}),
};

// ─── Composite narrative ────────────────────────────────────────────────────

/**
 * Category-state paragraph: the setting lead, the AANP practice-authority
 * sentence (skipped on the APRN axis, whose roles are regulated separately),
 * and the live posting count.
 *
 * The two `_` parameters are the retired cost-of-living index and the
 * retired behavioral-health shortage count. Neither renders any more (thin
 * spec 1 T6 and T11: the dataset behind each has no citation), but the
 * positional signature is kept for the template and the pinned tests until
 * W2-STATE and W4-INTEGRATE drop the arguments together.
 */
export function buildSettingStateNarrative(
    settingKey: string,
    stateName: string,
    stateCode: string,
    _avgCOL: number,
    _shortageCityCount: number,
    totalJobs: number,
): string {
    const parts: string[] = [];

    const lead = SETTING_LEADS[settingKey]?.({ stateName, stateCode });
    if (lead) parts.push(lead);

    // Sentence 2: practice authority (lib/state-practice-authority data). The
    // NP framework does not govern CRNA or CNM practice, so the APRN axis
    // carries its own regulatory clause inside the lead instead.
    if (getCategoryAxis(settingKey) !== 'aprn') {
        const auth = getStatePracticeAuthority(stateName);
        parts.push(
            auth
                ? `${stateName} grants ${AUTHORITY_PHRASES[auth.authority]}.`
                : `${stateName} applies state-specific practice rules; confirm current requirements with the ${stateCode} board of nursing before applying.`,
        );
    }

    // Sentence 3: the live count, stated as inventory rather than as a market
    // signal. The verb agrees with the count.
    parts.push(
        `The ${totalJobs} active ${totalJobs === 1 ? 'posting reflects' : 'postings reflect'} what employers currently list on ${brand.name} for ${stateName} in this category, not an estimate of the wider market.`,
    );

    return parts.join(' ');
}

// ─── Plain state-hub narrative ──────────────────────────────────────────────
// /jobs/state/[state]: the 51 plain state hubs previously shared one
// templated sentence, so every hub read near-identical to GoogleBot (the same
// thin-content failure mode the setting-state narrative above exists to
// defeat). This variant composes practice-authority context, the gated pay
// median, live category and city inventory, and the compact status into a
// deterministic per-state paragraph. Every figure is caller-supplied from
// live DB aggregation or repo regulatory data; nothing here invents numbers.

/** Authority-tier consequence clauses for the plain state hubs. */
const AUTHORITY_IMPLICATIONS: Record<PracticeAuthority, string> = {
    full: 'which supports independent practice models and widens the range of roles employers can offer',
    reduced: 'so collaborative-agreement logistics appear in many job requirements',
    restricted: 'so most roles are structured around physician-supervised care teams',
};

export interface PlainStateNarrativeInput {
    stateName: string;
    stateCode: string;
    /** Live count of published jobs in the state. */
    totalJobs: number;
    /**
     * Gated median of disclosed annual pay across the state's postings, in
     * $K (lib/salary-analytics.ts getGatedLocationSalary). Pass 0 when the
     * publishing gate fails: the pay sentence then says no median is
     * published and prints no figure. Omit it entirely and no pay sentence
     * renders at all.
     */
    medianSalaryK?: number;
    /**
     * @deprecated The retired arithmetic mean (PLAN.md T0-3: gated median or
     * nothing). Accepted so the state hub still compiles, and ignored: it
     * never renders, and it never stands in for `medianSalaryK`. W2-HUB
     * switches the caller to the gated median and W4-INTEGRATE deletes
     * this field.
     */
    avgSalaryK?: number;
    /** Live distinct-employer count for the state. */
    uniqueEmployerCount: number;
    /** Display labels of the top live-inventory categories, best-first. */
    topCategoryLabels: readonly string[];
    /** Names of the top cities by live job count, best-first. */
    topCityNames: readonly string[];
}

/**
 * Serial-comma list ("Houston, Dallas, and Austin"). lib/display-text.ts
 * joinWithAnd deliberately drops the serial comma for count lists; this
 * narrative's city list is pinned with it, so the helper stays local.
 */
function joinWithAnd(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** Compact sentence for the hub; the member branch keeps the pinned "membership" phrasing. */
function plainStateCompactSentence(stateName: string, stateCode: string): string {
    const env = getPracticeEnvironment(stateName);
    if (!env) {
        return `Confirm licensure requirements with the ${stateCode} board of nursing before applying.`;
    }
    if (env.nlcStatus === 'member') {
        return `${stateName}'s Nurse Licensure Compact membership covers the RN license beneath the APRN credential; the APRN license itself is still issued by ${stateName}.`;
    }
    return nlcSentence(stateName) ?? `Confirm licensure requirements with the ${env.boardName} before applying.`;
}

export function buildPlainStateNarrative(input: PlainStateNarrativeInput): string {
    const {
        stateName, stateCode, totalJobs,
        uniqueEmployerCount, topCategoryLabels, topCityNames,
    } = input;
    // The deprecated `avgSalaryK` is deliberately not read: a mean relabelled
    // as a median would be a false sentence on every hub.
    const medianK = input.medianSalaryK;
    const parts: string[] = [];

    // Sentence 1: live inventory and geography (DB aggregates only).
    const employerClause = uniqueEmployerCount > 0
        ? ` from ${uniqueEmployerCount} ${uniqueEmployerCount === 1 ? 'employer' : 'employers'}`
        : '';
    const cityClause = topCityNames.length > 0
        ? `, with hiring concentrated in ${joinWithAnd(topCityNames.slice(0, 3))}`
        : '';
    parts.push(
        `${stateName} currently has ${totalJobs} active ${brand.niche.descriptor} ${totalJobs === 1 ? 'posting' : 'postings'}${employerClause}${cityClause}.`,
    );

    // Sentence 2: top live-inventory categories (pseoStats setting-state rows).
    if (topCategoryLabels.length > 0) {
        const labels = topCategoryLabels.slice(0, 3);
        parts.push(
            labels.length === 1
                ? `By posting volume, ${labels[0]} roles carry the deepest live inventory in the state.`
                : `By posting volume, the most active categories right now are ${joinWithAnd(labels)}.`,
        );
    }

    // Sentence 3: practice authority (lib/state-practice-authority data).
    const auth = getStatePracticeAuthority(stateName);
    parts.push(
        auth
            ? `On the regulatory side, ${stateName} grants ${AUTHORITY_PHRASES[auth.authority]}, ${AUTHORITY_IMPLICATIONS[auth.authority]}.`
            : `On the regulatory side, ${stateName} applies state-specific practice rules; confirm current requirements with the ${stateCode} board of nursing before applying.`,
    );

    // Sentence 4: pay. Renders only when the caller passed the gated median;
    // below the gate the sentence says so and prints no figure of any kind,
    // and a caller that passes nothing gets no pay sentence.
    if (medianK !== undefined) {
        parts.push(
            medianK > 0
                ? `Across ${stateName} postings that disclose annual pay, the median is $${medianK}K per year.`
                : `Not enough ${stateName} postings disclose pay to publish a state median, so compare compensation posting by posting.`,
        );
    }

    // Sentence 5: compact status (practice-environment.ts, NCSBN roster).
    parts.push(plainStateCompactSentence(stateName, stateCode));

    return parts.join(' ');
}

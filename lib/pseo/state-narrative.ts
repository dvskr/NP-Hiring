/**
 * State Narrative — deterministic per-(setting, state) content snippets.
 *
 * Mirrors the city-narrative pattern at lib/pseo/city-narrative.ts so every
 * indexable /jobs/{setting}/{state} page gets a substantively unique 2-3
 * sentence paragraph driven by structured facts. Two state pages with the
 * same (setting, state) pair will read the same; any other pair produces
 * measurably different prose because the fact mix differs.
 *
 * Goal: defeat Google's "Crawled — currently not indexed" thin-content flag
 * for pSEO state pages, where previously the only state-specific content
 * was stat interpolation (counts, COL, shortage count) wrapped in a shared
 * template. Two cats (e.g. remote/CA vs telehealth/CA) read 95% identical
 * to GoogleBot. This file fixes that.
 *
 * Also exports buildPlainStateNarrative — the same idea for the 51 plain
 * /jobs/state/[state] hubs (see the section at the bottom of this file).
 */
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';
// One shortage-claim gate for both narrative modules — defined in the city
// narrative because that is the leaf module both templates already import.
import { shortageColumnAppliesTo } from './city-narrative';
import {
    getStatePracticeAuthority,
    PracticeAuthority,
} from '@/lib/state-practice-authority';

// ─── Tiers ──────────────────────────────────────────────────────────────────

type COLTier = 'high-cost' | 'above-avg' | 'average' | 'below-avg' | 'low-cost';
type DemandTier = 'very-high' | 'high' | 'moderate' | 'low';

function colTier(col: number): COLTier {
    if (col >= 130) return 'high-cost';
    if (col >= 110) return 'above-avg';
    if (col >= 95) return 'average';
    if (col >= 85) return 'below-avg';
    return 'low-cost';
}

function demandTier(totalJobs: number): DemandTier {
    if (totalJobs >= 100) return 'very-high';
    if (totalJobs >= 30) return 'high';
    if (totalJobs >= 10) return 'moderate';
    return 'low';
}

// ─── Phrase fragments ───────────────────────────────────────────────────────

const COST_PHRASES: Record<COLTier, string> = {
    'high-cost': 'high cost of living relative to the national average',
    'above-avg': 'above-average cost of living',
    'average': 'cost of living near the national average',
    'below-avg': 'below-average cost of living',
    'low-cost': 'low cost of living relative to the national average',
};

const AUTHORITY_PHRASES: Record<PracticeAuthority, string> = {
    full: 'full practice authority — independent prescribing without physician oversight',
    reduced: 'reduced practice authority requiring a collaborative agreement with a physician',
    restricted: 'restricted practice authority requiring physician supervision',
};

const DEMAND_PHRASES: Record<DemandTier, string> = {
    'very-high': 'consistently high demand',
    'high': 'strong demand',
    'moderate': 'moderate demand',
    'low': 'a smaller pool of openings',
};

// ─── NLC (Nurse Licensure Compact) membership ───────────────────────────────
// Compact lets RNs hold one multistate license valid across member states
// (RN/LPN layer only — never the APRN license itself). CANONICAL sets —
// mirrored in lib/blog-license-guides.ts and kept in sync by the drift test
// in tests/regressions/p1-content-library-license-guides.test.ts; update all
// copies together when membership shifts.
//
// Verified against the live NCSBN roster (nursecompact.com implementation
// table) on 2026-08-11 — the same date as NLC_ROSTER_VERIFIED_AT in
// lib/blog-license-guides.ts. The pre-2026-08 revision wrongly listed
// Connecticut (implemented 2025-10-01), Rhode Island (2024-01-08), and
// Washington (2024-01-31) as non-members, omitted Alaska, and carried
// Massachusetts as a plain non-member.

/** No enacted compact legislation — a separate state license is required. */
const NLC_NON_MEMBER_STATES: ReadonlySet<string> = new Set([
    'Alaska', 'California', 'District of Columbia', 'Hawaii', 'Illinois',
    'Michigan', 'Minnesota', 'Nevada', 'New York', 'Oregon',
]);

// Enacted the compact but not yet implemented it (NCSBN implementation
// date: to-be-determined). Until implementation, multistate licenses are
// neither issued nor honored there — a boolean member/non-member flag
// cannot represent this, so every narrative renders a distinct
// "enacted, implementation pending — verify with the board" branch.
const NLC_ENACTED_PENDING_STATES: ReadonlySet<string> = new Set([
    'Massachusetts',
]);

type NlcStatus = 'member' | 'pending' | 'non-member';

function nlcStatusOf(stateName: string): NlcStatus {
    if (NLC_ENACTED_PENDING_STATES.has(stateName)) return 'pending';
    return NLC_NON_MEMBER_STATES.has(stateName) ? 'non-member' : 'member';
}

// ─── Setting-specific lead phrases ──────────────────────────────────────────
// One per SETTING_CONFIGS key. Each takes the state context so the lead is
// (slightly) state-aware where relevant (e.g. Compact-state remote roles).

interface StateCtx {
    stateName: string;
    stateCode: string;
    practiceAuthority: PracticeAuthority | null;
    avgCOL: number;
    shortageCityCount: number;
    totalJobs: number;
}

type SettingLeadFn = (ctx: StateCtx) => string;

const SETTING_LEADS: Record<string, SettingLeadFn> = {
    'remote': (c) => {
        const lead = `Remote ${brand.niche.short} positions covering patients in ${c.stateName} typically pay $110K–$170K and require active ${c.stateCode} state licensure plus a HIPAA-compliant home setup.`;
        switch (nlcStatusOf(c.stateName)) {
            case 'member':
                return `${lead} Most postings welcome multi-state Compact licensure to broaden caseload reach.`;
            case 'pending':
                return `${lead} ${c.stateName} has enacted the Nurse Licensure Compact but has not yet implemented it, so a separate ${c.stateCode} license is still required until the state board of nursing announces an implementation date.`;
            case 'non-member':
                return `${lead} ${c.stateName} is not a Nurse Licensure Compact member, so a separate ${c.stateCode} license is required even if you already hold a multistate license elsewhere.`;
        }
    },
    'telehealth': (c) => {
        const lead = `Telehealth ${brand.niche.short} roles serving the ${c.stateName} market combine asynchronous documentation with scheduled video visits.`;
        switch (nlcStatusOf(c.stateName)) {
            case 'member':
                return `${lead} Employers require HIPAA-compliant equipment and at least a ${c.stateCode} license; multi-state Compact licensure expands earning potential.`;
            case 'pending':
                return `${lead} Employers require HIPAA-compliant equipment and a ${c.stateCode} license — ${c.stateName} has enacted the Nurse Licensure Compact but implementation is pending, so multistate-licensed clinicians still need a separate ${c.stateCode} credential until the board completes implementation.`;
            case 'non-member':
                return `${lead} Employers require HIPAA-compliant equipment and a ${c.stateCode} license — ${c.stateName} is not a Compact member, so multistate-licensed clinicians still need a separate ${c.stateCode} credential.`;
        }
    },
    'inpatient': (c) => `Inpatient ${brand.niche.short} positions across ${c.stateName} cover acute inpatient units, hospitalist services, and step-down roles. Shift differentials, weekend premiums, and on-call stipends are standard alongside base salary.`,
    'outpatient': (c) => `Outpatient ${brand.niche.short} roles in ${c.stateName} span community health centers, group practices, and integrated primary-care settings. Caseloads typically run 12–18 patients per day with documentation time built in.`,
    'travel': (c) => `Travel ${brand.niche.short} assignments in ${c.stateName} are usually 8–26 weeks with tax-free housing stipends, completion bonuses, and 20–50% premium pay over permanent equivalents. Most agencies handle multi-state licensure logistics.`,
    'contract': (c) => `Contract ${brand.niche.short} positions in ${c.stateName} are typically defined-term W-2 engagements (90 days to 24 months) booked through staffing agencies, paying $70–$130 per hour with agency-provided malpractice. Distinct from 1099 independent contracting, contract roles preserve employer payroll-tax handling and often include short-term health coverage.`,
    // NHSC framing here and in 'new-grad' below explains the program's
    // MECHANICS instead of asserting eligibility or quoting an award. The
    // prior copy claimed blanket "NHSC eligibility" for correctional roles
    // and "up to $75K for a two-year commitment" for FQHC new-grad roles —
    // a figure that traces to nothing in lib/stats-sources.ts and disagreed
    // with the different amount the city narrative used to quote for the same
    // program. HRSA resets award tiers and eligible disciplines each cycle,
    // and eligibility runs through a specific site's active NHSC approval.
    'correctional': (c) => `Correctional ${brand.niche.short} roles in ${c.stateName} facilities often offer state-employee benefits, robust pension plans, and loan-repayment help through state-run programs. Correctional facilities are one of HRSA's eligible NHSC site types, so federal loan repayment turns on whether the individual facility holds an active NHSC site approval.`,
    'full-time': (c) => `Full-time ${brand.niche.short} positions in ${c.stateName} typically bundle employer-sponsored health insurance, 401(k) match, CME allowance, malpractice coverage, and 3–4 weeks of PTO into a $110K–$170K base. Total-comp comparisons against contract or per-diem rates should net out the benefits self-funded employers don't have to cover.`,
    'part-time': (c) => `Part-time ${brand.niche.short} roles in ${c.stateName} generally pay $60–$100 per hour and run 16–32 scheduled hours weekly, with prorated benefits at larger health systems and none at smaller practices. The structure is popular for clinicians maintaining a private practice on the side or stepping down from a full caseload.`,
    'new-grad': (c) => `New-grad ${brand.niche.short} positions in ${c.stateName} typically start at $95K–$140K and emphasize structured onboarding — formal preceptorship, gradual caseload ramp over 3–6 months, and protected supervision time. Community health centers and FQHCs are among the site types HRSA treats as automatically eligible for NHSC approval, so ask a prospective employer for its current NHSC site status: loan repayment follows the approved site and the applicant's discipline, on award tiers HRSA sets each cycle.`,
    '1099': (c) => `Independent-contractor (1099) ${brand.niche.short} roles in ${c.stateName} pay $60–$150+ per hour without benefits or employer-paid malpractice. Clinicians self-fund quarterly estimated taxes, occurrence-based malpractice, and any LLC or PLLC structure — net take-home depends heavily on those offsets and ${c.stateCode} self-employment tax exposure.`,
    // ── 2026-07 NP taxonomy state pages (job types + specialties + APRN) ──
    // Covers the remaining SETTING_CONFIGS keys so every /jobs/{setting}/{state}
    // page type gets a distinct lead instead of only the shared authority/COL
    // sentences (the near-duplicate pattern this file exists to defeat).
    'per-diem': (c) => `Per-diem ${brand.niche.short} shifts across ${c.stateName} pay premium hourly rates in exchange for zero guaranteed hours, and most clinicians credential at two or three facilities to smooth volume. Each site onboards separately, so current licensure and certification paperwork shortens time-to-first-shift.`,
    'locum-tenens': (c) => {
        const lead = `Locum tenens ${brand.niche.short} assignments in ${c.stateName} typically run 4–26 weeks with agency-covered malpractice, travel, and housing.`;
        switch (nlcStatusOf(c.stateName)) {
            case 'member':
                return `${lead} ${c.stateName}'s Nurse Licensure Compact membership lets multistate-licensed clinicians start assignments with minimal licensing lead time.`;
            case 'pending':
                return `${lead} ${c.stateName} has enacted the Nurse Licensure Compact but implementation is pending, so budget extra lead time for a separate ${c.stateCode} license until the state board announces an implementation date.`;
            case 'non-member':
                return `${lead} ${c.stateName} is not a Nurse Licensure Compact member, so budget extra lead time for a separate ${c.stateCode} license before your start date.`;
        }
    },
    'family-practice': (c) => `Family practice ${brand.niche.short} (FNP) roles across ${c.stateName} anchor primary-care access, from urban group practices to rural health clinics. FNP is the most widely recognized ${brand.niche.short} certification among ${c.stateName} employers.`,
    'adult-gerontology': (c) => `Adult-gerontology ${brand.niche.short} demand in ${c.stateName} tracks the aging patient base: AGPCNPs staff primary-care and long-term-care settings while AGACNPs cover hospital and specialty services.`,
    'pediatric': (c) => `Pediatric ${brand.niche.short} roles in ${c.stateName} span primary-care pediatrics, children's hospitals, and school-based programs. Acute-care PNP positions cluster around the state's larger children's facilities.`,
    'women-health': (c) => `Women's health ${brand.niche.short} (WHNP) positions across ${c.stateName} sit in OB/GYN groups, family-planning programs, and prenatal clinics, often working alongside certified nurse midwives.`,
    'acute-care': (c) => `Acute care ${brand.niche.short} positions across ${c.stateName} concentrate in ICUs, step-down units, and hospitalist services, generally on 13-hour shift patterns with differentials for nights and weekends.`,
    'emergency': (c) => `Emergency ${brand.niche.short} roles across ${c.stateName} staff emergency departments and fast-track units. Employers typically expect prior emergency or acute-care experience plus procedural competency.`,
    'anesthesia': (c) => `CRNA positions across ${c.stateName} carry the highest APRN pay bands — typically $180K–$250K+. Compensation varies with call burden and with whether the practice runs a supervision-based or independent CRNA model.`,
    'midwifery': (c) => `Certified nurse midwife (CNM) roles in ${c.stateName} cover hospital labor-and-delivery services, birth centers, and OB/GYN practices; call frequency and delivery volume drive most compensation differences.`,
    // ── 2026-07 P1 #14 [state] tier extension ──
    // One lead per config added in setting-state-config.ts's P1 #14 block.
    // Salary bands mirror those configs' salaryRange values exactly so the
    // narrative and hero stats never disagree on the same page.
    'primary-care': (c) => `Primary care ${brand.niche.short} positions across ${c.stateName} span internal-medicine groups, FQHCs, and value-based-care organizations, typically paying $100K–$140K. Panel size, documentation time, and quality-incentive structure drive most of the practical differences between offers in the state.`,
    'oncology': (c) => `Oncology ${brand.niche.short} roles in ${c.stateName} concentrate around the state's cancer centers and hematology-oncology groups, typically paying $110K–$150K. ${brand.niche.short}-led survivorship programs are an expanding share of the state's oncology hiring as survivor populations grow.`,
    'cardiology': (c) => `Cardiology ${brand.niche.short} openings across ${c.stateName} split between heart-failure and device clinics and inpatient consult services, typically paying $110K–$150K. Hybrid clinic-plus-hospital roles usually add call stipends and weekend differentials on top of base pay.`,
    'hospitalist': (c) => `Hospitalist ${brand.niche.short} positions in ${c.stateName} run on block schedules — commonly seven-on/seven-off — covering admissions, rounding, and cross-cover, typically paying $110K–$150K. Acute care certification (AGACNP) is the preferred credential at most of the state's hospital medicine programs.`,
    'dermatology': (c) => `Dermatology ${brand.niche.short} roles in ${c.stateName} pair medical dermatology with procedural clinic work, typically paying $110K–$155K on weekday schedules without inpatient call. Appointment demand outstrips supply in most ${c.stateName} markets, making productivity bonuses a common negotiation lever.`,
    'urgent-care': (c) => `Urgent care ${brand.niche.short} roles across ${c.stateName} run on defined shift schedules with no after-hours panel obligations, typically paying $105K–$140K. Statewide clinic expansion keeps hiring continuous, and employers screen for episodic acute-care skills across the lifespan.`,
    'home-health': (c) => `Home health ${brand.niche.short} roles in ${c.stateName} put clinicians on the road for house calls, transitional-care visits, and annual wellness assessments, typically paying $100K–$135K. Territory size, daily visit expectations, and mileage terms vary widely between programs and materially change effective pay.`,
    // Keyed via the registry-derived constant so the specialty slug literal
    // stays confined to taxonomy-registry.ts (niche-copy debt ratchet).
    ...(PSYCH_SPECIALTY_SLUG
        ? {
            [PSYCH_SPECIALTY_SLUG]: ((c) => `Behavioral-health ${brand.niche.short} roles across ${c.stateName} span outpatient clinics, telehealth platforms, and integrated care settings, typically paying $120K–$170K, with demand elevated by nationwide prescriber shortages.`) as SettingLeadFn,
        }
        : {}),
};

// ─── Composite narrative ────────────────────────────────────────────────────

export function buildSettingStateNarrative(
    settingKey: string,
    stateName: string,
    stateCode: string,
    avgCOL: number,
    shortageCityCount: number,
    totalJobs: number,
): string {
    const auth = getStatePracticeAuthority(stateName);
    const ctx: StateCtx = {
        stateName,
        stateCode,
        practiceAuthority: auth?.authority ?? null,
        avgCOL,
        shortageCityCount,
        totalJobs,
    };

    const lead = SETTING_LEADS[settingKey]?.(ctx);
    const parts: string[] = [];
    if (lead) parts.push(lead);

    // Sentence 2: practice authority + COL anchor.
    const authPhrase = ctx.practiceAuthority
        ? AUTHORITY_PHRASES[ctx.practiceAuthority]
        : 'state-specific practice rules';
    parts.push(
        `${stateName} grants ${authPhrase}, and the state's ${COST_PHRASES[colTier(avgCOL)]} (index ${avgCOL}) directly shapes ${brand.niche.short} compensation expectations.`,
    );

    // Sentence 3: live demand. Unconditional and designation-free.
    //
    // WAS: a two-branch sentence in which BOTH branches published something
    // false. The affirmative branch called the metros' designation "federal
    // Health Professional Shortage Area designation" with no discipline named
    // — `shortageCityCount` is computed from `CityData.mentalHealthShortage`,
    // the donor board's BEHAVIORAL-HEALTH HPSA column (see
    // ./city-data/types.ts) — and then concluded that "positions in those
    // areas typically qualify for NHSC Loan Repayment". They do not: NHSC LRP
    // matches the applicant's discipline to the designation type and pays
    // only for service at an NHSC-approved site, so a metro's HPSA status
    // establishes nothing about a given posting. The negative branch inverted
    // the same error, asserting the metros are "not currently federally
    // designated health professional shortage areas" across ALL disciplines
    // on the strength of one discipline's column. Passing 0 therefore only
    // swapped one false claim for the other, so the fix is here in the
    // sentence rather than in the caller's input.
    const demandPhrase = DEMAND_PHRASES[demandTier(totalJobs)];
    parts.push(
        `The ${totalJobs} active ${totalJobs === 1 ? 'posting reflects' : 'postings reflect'} ${demandPhrase} for ${brand.niche.descriptor}s across ${stateName}, alongside the state's reimbursement structure and employer mix.`,
    );

    // Sentence 3b: the designation — named by discipline, scoped to the one
    // category whose specialty that discipline describes (the same gate the
    // city template applies to its own shortage surfaces, P2 #7), and framed
    // as the program's mechanics rather than a promise of eligibility.
    if (shortageCityCount > 0 && shortageColumnAppliesTo(settingKey)) {
        parts.push(
            `${shortageCityCount} of the state's top metros carry a federal HRSA behavioral-health Health Professional Shortage Area (HPSA) designation, which is what puts National Health Service Corps Loan Repayment within reach for behavioral-health clinicians at NHSC-approved sites in those areas — awards follow the site's approval and the applicant's discipline, not the metro alone.`,
        );
    }

    return parts.join(' ');
}

// ─── Plain state-hub narrative ──────────────────────────────────────────────
// /jobs/state/[state] — the 51 plain state hubs previously shared one
// templated sentence, so every hub read near-identical to GoogleBot (the same
// thin-content failure mode the setting-state narrative above exists to
// defeat). This variant composes practice-authority context, the live salary
// aggregate, live category/city inventory, and the NLC membership note into a
// deterministic per-state paragraph. Every figure is caller-supplied from
// live DB aggregation or repo regulatory data — nothing here invents numbers.

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
    /** Live average of disclosed salary bounds, in $K; 0 = insufficient data. */
    avgSalaryK: number;
    /** Live distinct-employer count for the state. */
    uniqueEmployerCount: number;
    /** Display labels of the top live-inventory categories, best-first. */
    topCategoryLabels: readonly string[];
    /** Names of the top cities by live job count, best-first. */
    topCityNames: readonly string[];
}

function joinWithAnd(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function buildPlainStateNarrative(input: PlainStateNarrativeInput): string {
    const {
        stateName, stateCode, totalJobs, avgSalaryK,
        uniqueEmployerCount, topCategoryLabels, topCityNames,
    } = input;
    const parts: string[] = [];

    // Sentence 1: live inventory + geography (DB aggregates only).
    const employerClause = uniqueEmployerCount > 0
        ? ` from ${uniqueEmployerCount} ${uniqueEmployerCount === 1 ? 'employer' : 'employers'}`
        : '';
    const cityClause = topCityNames.length > 0
        ? `, with hiring concentrated in ${joinWithAnd(topCityNames.slice(0, 3))}`
        : '';
    parts.push(
        `${stateName} currently has ${totalJobs} active ${brand.niche.descriptor} ${totalJobs === 1 ? 'posting' : 'postings'}${employerClause}${cityClause} — reflecting ${DEMAND_PHRASES[demandTier(totalJobs)]} for ${brand.niche.short}s statewide.`,
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
            : `On the regulatory side, ${stateName} applies state-specific practice rules — confirm current requirements with the ${stateCode} board of nursing before applying.`,
    );

    // Sentence 4: salary — the live state aggregate only, never an invented band.
    parts.push(
        avgSalaryK > 0
            ? `Postings that disclose pay currently average $${avgSalaryK}K per year across settings and experience levels.`
            : `Not enough ${stateName} postings disclose pay to compute a live average, so compare compensation posting by posting.`,
    );

    // Sentence 5: NLC status (NCSBN-sourced sets above — member, enacted-
    // pending-implementation, and non-member each get an honest sentence).
    const nlcStatus = nlcStatusOf(stateName);
    parts.push(
        nlcStatus === 'member'
            ? `${stateName}'s Nurse Licensure Compact membership shortens licensing lead time for multistate-licensed clinicians picking up ${stateCode} roles.`
            : nlcStatus === 'pending'
                ? `${stateName} has enacted the Nurse Licensure Compact but has not yet implemented it, so until the state board of nursing announces an implementation date, clinicians licensed elsewhere should still budget time for a separate ${stateCode} license.`
                : `${stateName} is not a Nurse Licensure Compact member, so clinicians licensed elsewhere should budget extra time for a separate ${stateCode} license through the state board of nursing.`,
    );

    return parts.join(' ');
}

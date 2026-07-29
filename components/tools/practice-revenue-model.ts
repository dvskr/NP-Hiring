/**
 * Private-practice revenue model (P3 #6a).
 *
 * PROVENANCE — READ BEFORE CHANGING A NUMBER
 * Every default in this file MIRRORS the revenue model already published on
 * /resources/private-practice-guide (its PRACTICE_MODEL and PRACTICE_SCENARIOS
 * constants). That page computes its whole income table from those figures and
 * renders the assumptions above the table; this projector exists so a reader
 * can re-run the same arithmetic with their own inputs instead of reading a
 * fixed table.
 *
 * The guide's constants are module-private to its page component, so they are
 * mirrored here rather than imported. tests/regressions/p3-tools-round-2-*.test.ts
 * reads the guide source and fails if the two ever disagree — that test is the
 * only thing keeping this file honest, so do not delete it and do not "fix" a
 * mismatch by editing the test.
 *
 * TRUTH RULES
 *  1. A default is either (a) traceable to the guide's published figures, or
 *     (b) zero and labelled a user-supplied assumption. There is no third
 *     category. `noShowPct` and `fixedAnnualCosts` are (b) — nothing in repo
 *     data supports a figure for either, so they start at zero and the UI says
 *     why.
 *  2. The per-visit amounts are what a practice COLLECTS, not what it charges.
 *     The guide is explicit about this and so is the widget.
 *  3. Output is an illustration of arithmetic, not a projection of what a
 *     practice will earn, and not a financial projection in any regulatory
 *     sense. Net is before self-employment tax and income tax.
 *
 * Pure functions and plain data — no 'use client'.
 */

/** The guide's page path, for the provenance links the widget renders. */
export const PRACTICE_GUIDE_PATH = '/resources/private-practice-guide';

/**
 * Mirrors PRACTICE_MODEL in the guide.
 *  - workingWeeksPerYear 46: 52 less roughly six for holidays, vacation, admin.
 *  - the two per-visit figures are blended COLLECTED amounts, stated by the
 *    guide as planning inputs rather than contracted rates.
 */
export const GUIDE_MODEL = {
    workingWeeksPerYear: 46,
    insuranceCollectedPerVisit: 175,
    cashCollectedPerVisit: 250,
} as const;

export interface GuideScenario {
    /** Stable key used as the preset <select> value. */
    key: string;
    /** Label as published in the guide's table. */
    label: string;
    visitsPerWeek: { min: number; max: number };
    collectedPerVisit: number;
    /** Overhead as a share of collections, 0–1 — the guide's own units. */
    overhead: { min: number; max: number };
}

/** Mirrors PRACTICE_SCENARIOS in the guide, in the same order. */
export const GUIDE_SCENARIOS: readonly GuideScenario[] = [
    {
        key: 'part-time-telehealth',
        label: 'Part-time telehealth',
        visitsPerWeek: { min: 12, max: 15 },
        collectedPerVisit: GUIDE_MODEL.insuranceCollectedPerVisit,
        overhead: { min: 0.15, max: 0.20 },
    },
    {
        key: 'full-time-telehealth',
        label: 'Full-time telehealth',
        visitsPerWeek: { min: 22, max: 28 },
        collectedPerVisit: GUIDE_MODEL.insuranceCollectedPerVisit,
        overhead: { min: 0.15, max: 0.25 },
    },
    {
        key: 'full-time-office',
        label: 'Full-time office',
        visitsPerWeek: { min: 22, max: 28 },
        collectedPerVisit: GUIDE_MODEL.insuranceCollectedPerVisit,
        overhead: { min: 0.30, max: 0.40 },
    },
    {
        key: 'cash-pay',
        label: 'Cash-pay panel',
        visitsPerWeek: { min: 18, max: 25 },
        collectedPerVisit: GUIDE_MODEL.cashCollectedPerVisit,
        overhead: { min: 0.15, max: 0.25 },
    },
];

/** The scenario the projector opens on — the guide's own headline row. */
export const DEFAULT_SCENARIO_KEY = 'full-time-telehealth';

export interface GuideBand {
    grossMin: number;
    grossMax: number;
    netMin: number;
    netMax: number;
}

/**
 * The band the guide's table publishes for a scenario, computed the guide's
 * way: the worst case pairs the LOWEST volume with the HIGHEST overhead and
 * vice versa, so the band brackets outcomes instead of stacking best cases.
 *
 * The widget renders this next to the point estimate so a reader can see the
 * projector reproduces the published table rather than replacing it.
 */
export function guideBand(scenario: GuideScenario): GuideBand {
    const grossMin = scenario.visitsPerWeek.min * GUIDE_MODEL.workingWeeksPerYear * scenario.collectedPerVisit;
    const grossMax = scenario.visitsPerWeek.max * GUIDE_MODEL.workingWeeksPerYear * scenario.collectedPerVisit;
    return {
        grossMin,
        grossMax,
        netMin: grossMin * (1 - scenario.overhead.max),
        netMax: grossMax * (1 - scenario.overhead.min),
    };
}

export interface ProjectorInputs {
    /** Scheduled visits per week. */
    visitsPerWeek: number;
    /** Working weeks per year. */
    weeksPerYear: number;
    /** Amount COLLECTED per completed visit. */
    collectedPerVisit: number;
    /** Overhead as a percentage of collections (0–100). */
    overheadPct: number;
    /**
     * Percentage of scheduled visits that do not complete (no-shows, late
     * cancellations). USER-SUPPLIED — the guide publishes no figure for this,
     * so the default is 0 and the widget labels it as an assumption you own.
     */
    noShowPct: number;
    /**
     * Fixed annual costs NOT already inside the overhead percentage — a lease,
     * a specific EHR contract, a billing retainer. USER-SUPPLIED, default 0:
     * publishing a dollar default for any of these would be inventing vendor
     * pricing, which the guide explicitly refuses to do.
     */
    fixedAnnualCosts: number;
}

/**
 * A preset built from a guide scenario. Volume and overhead are the MIDPOINT of
 * the guide's published bands — a point estimate needs one number and the
 * midpoint is the only choice that does not tilt the result; the guide's full
 * band is displayed alongside so nothing is lost.
 */
export function presetFor(scenario: GuideScenario): ProjectorInputs {
    return {
        visitsPerWeek: Math.round((scenario.visitsPerWeek.min + scenario.visitsPerWeek.max) / 2),
        weeksPerYear: GUIDE_MODEL.workingWeeksPerYear,
        collectedPerVisit: scenario.collectedPerVisit,
        overheadPct: ((scenario.overhead.min + scenario.overhead.max) / 2) * 100,
        noShowPct: 0,
        fixedAnnualCosts: 0,
    };
}

export interface Projection {
    scheduledVisits: number;
    completedVisits: number;
    grossCollections: number;
    /** Overhead as a share of collections, in dollars. */
    overheadCost: number;
    fixedCosts: number;
    totalCosts: number;
    /** Collections less overhead less fixed costs. Before any tax. */
    netBeforeTax: number;
    /** Net per completed visit — the number that tells you if volume helps. */
    netPerCompletedVisit: number;
    /** Total costs as a percentage of collections, including fixed costs. */
    totalCostPctOfGross: number;
}

const atLeastZero = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const clampPct = (n: number): number => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

export function project(inputs: ProjectorInputs): Projection {
    const visitsPerWeek = atLeastZero(inputs.visitsPerWeek);
    const weeksPerYear = atLeastZero(inputs.weeksPerYear);
    const collectedPerVisit = atLeastZero(inputs.collectedPerVisit);
    const overheadPct = clampPct(inputs.overheadPct);
    const noShowPct = clampPct(inputs.noShowPct);
    const fixedCosts = atLeastZero(inputs.fixedAnnualCosts);

    const scheduledVisits = visitsPerWeek * weeksPerYear;
    const completedVisits = scheduledVisits * (1 - noShowPct / 100);
    const grossCollections = completedVisits * collectedPerVisit;
    const overheadCost = grossCollections * (overheadPct / 100);
    const totalCosts = overheadCost + fixedCosts;
    const netBeforeTax = grossCollections - totalCosts;

    return {
        scheduledVisits,
        completedVisits,
        grossCollections,
        overheadCost,
        fixedCosts,
        totalCosts,
        netBeforeTax,
        netPerCompletedVisit: completedVisits > 0 ? netBeforeTax / completedVisits : 0,
        totalCostPctOfGross: grossCollections > 0 ? (totalCosts / grossCollections) * 100 : 0,
    };
}

/** The relative moves the sensitivity table applies to each driver. */
export const SENSITIVITY_STEPS: readonly number[] = [-0.2, -0.1, 0.1, 0.2];

/** Which input a sensitivity row varies. */
export type SensitivityDriver = 'visitsPerWeek' | 'collectedPerVisit' | 'overheadPct';

export interface SensitivityPoint {
    /** Relative move applied to the driver, e.g. -0.1 for 10% lower. */
    step: number;
    /** The driver's value at this step. */
    value: number;
    net: number;
    /** net at this step less net at the base case. */
    netDelta: number;
}

export interface SensitivityRow {
    driver: SensitivityDriver;
    label: string;
    /** Base value of the driver, for the row header. */
    baseValue: number;
    points: readonly SensitivityPoint[];
    /** Net swing across the widest steps — how much this driver matters. */
    swing: number;
}

const DRIVER_LABELS: Record<SensitivityDriver, string> = {
    visitsPerWeek: 'Visits per week',
    collectedPerVisit: 'Collected per visit',
    overheadPct: 'Overhead share',
};

/** Explicit per-driver override — a computed key would widen the input type. */
function withDriver(inputs: ProjectorInputs, driver: SensitivityDriver, value: number): ProjectorInputs {
    if (driver === 'visitsPerWeek') return { ...inputs, visitsPerWeek: value };
    if (driver === 'collectedPerVisit') return { ...inputs, collectedPerVisit: value };
    return { ...inputs, overheadPct: value };
}

/**
 * How the net moves when each driver moves on its own.
 *
 * This is the point of the tool: a single net figure invites false precision,
 * and the honest correction is to show that a 10% miss on volume or
 * reimbursement moves the answer by tens of thousands of dollars.
 */
export function sensitivity(inputs: ProjectorInputs): readonly SensitivityRow[] {
    const baseNet = project(inputs).netBeforeTax;
    const drivers: readonly SensitivityDriver[] = ['visitsPerWeek', 'collectedPerVisit', 'overheadPct'];

    return drivers.map((driver) => {
        const baseValue = inputs[driver];
        const points = SENSITIVITY_STEPS.map((step) => {
            const value = baseValue * (1 + step);
            const net = project(withDriver(inputs, driver, value)).netBeforeTax;
            return { step, value, net, netDelta: net - baseNet };
        });
        const nets = points.map((point) => point.net);
        return {
            driver,
            label: DRIVER_LABELS[driver],
            baseValue,
            points,
            swing: Math.max(...nets) - Math.min(...nets),
        };
    });
}

/**
 * What one more scheduled visit per week is worth per year at the current
 * inputs — the most actionable number in the model, and the one that makes the
 * volume assumption concrete.
 */
export function oneMoreVisitPerWeek(inputs: ProjectorInputs): number {
    const base = project(inputs).netBeforeTax;
    const withOneMore = project({ ...inputs, visitsPerWeek: atLeastZero(inputs.visitsPerWeek) + 1 }).netBeforeTax;
    return withOneMore - base;
}

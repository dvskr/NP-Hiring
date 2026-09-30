/**
 * lib/salary-guide-gate.ts: the employer-share cap on every published
 * posted-pay median (indexing audit CQ-15).
 *
 * The benchmark publishing gate (components/tools/benchmark-model.ts) asks
 * for BENCHMARK_MIN_POSTINGS postings from BENCHMARK_MIN_EMPLOYERS
 * employers, but it never asked how the postings split between those
 * employers. The audit found /salary-guide/virginia publishing a "state"
 * median from 26 postings across 5 employers while one employer held 13 of
 * the state's 33 roles: a figure that leans heavily on one employer's pay
 * scale. Once one employer holds more than half of a sample, the median
 * necessarily falls inside that employer's own pay range.
 *
 * THE RULE: a scope publishes a median only when, on top of the existing
 * gate, no single employer contributes more than MAX_EMPLOYER_SHARE_PERCENT
 * of the postings behind it. Below the cap the scope is treated exactly like
 * a below-gate scope: no median, no quartiles, no index. It is NOT replaced
 * by a range with the employer named, because a range dominated by a named
 * employer would publish that employer's pay band, which the benchmark
 * model's public-safety rule 2 forbids.
 *
 * IDENTITY: employers are grouped by the same alias rule the listing facts
 * use (lib/pseo/listing-facts.ts employerIdentity: the canonical company
 * name first, then the normalizer's key), so "LifeStance" and "LifeStance
 * Health" count as one employer here even though the older distinct-employer
 * count in benchmark-model.ts compares raw strings. That can only make the
 * cap stricter, never looser.
 *
 * ELIGIBILITY mirrors summarizeBenchmarks row for row: a row counts only
 * with a scope (state), an employer and a positive normalized minimum.
 *
 * Every exported function is a pure function of its input (the only state
 * is a bounded memo of employer keys), so the gate is testable without a
 * database.
 */
import {
    summarizeBenchmarks,
    type BenchmarkInputRow,
    type BenchmarkRow,
    type BenchmarkSummary,
} from '@/components/tools/benchmark-model';
import { findCanonicalName, normalizeCompanyName } from '@/lib/company-normalizer';
import { MAX_EMPLOYER_SHARE_PERCENT } from '@/lib/salary-guide-policy';

/**
 * The cap value lives in lib/salary-guide-policy.ts, an import-free module,
 * so a client component or a pure copy builder can state the rule without
 * pulling this file (and the Prisma client behind company-normalizer) into
 * its bundle. Re-exported here for the server surfaces that apply it.
 */
export { MAX_EMPLOYER_SHARE_PERCENT };

/** How one scope's benchmark sample splits between employers. */
export interface EmployerConcentration {
    /** Rows that enter the benchmark sample (scope, employer, positive minimum). */
    postings: number;
    /** Distinct employers behind them, alias merged. */
    employers: number;
    /** Postings from the single largest employer (0 for an empty sample). */
    topEmployerPostings: number;
}

const EMPTY_CONCENTRATION: EmployerConcentration = { postings: 0, employers: 0, topEmployerPostings: 0 };

/**
 * Memo for employerKey. findCanonicalName re-normalizes every known alias
 * on each call, and one page render summarizes the same employer names
 * several times (state, board, sub-pools, cities), so keys are kept per
 * process. Bounded: cleared when it outgrows any realistic employer roster.
 */
const EMPLOYER_KEY_MEMO_LIMIT = 5_000;
const employerKeyMemo = new Map<string, string>();

/** Alias-merged employer key, the same rule as the listing facts' employerIdentity. */
function employerKey(raw: string): string {
    const memo = employerKeyMemo.get(raw);
    if (memo !== undefined) return memo;
    const canonical = findCanonicalName(raw);
    const key = canonical ? `canonical:${canonical}` : normalizeCompanyName(raw) || raw.toLowerCase();
    if (employerKeyMemo.size >= EMPLOYER_KEY_MEMO_LIMIT) employerKeyMemo.clear();
    employerKeyMemo.set(raw, key);
    return key;
}

/** True when a row enters the benchmark sample (summarizeBenchmarks eligibility). */
function isSampleRow(row: BenchmarkInputRow): row is BenchmarkInputRow & { state: string; employer: string } {
    return Boolean(row.state) && Boolean(row.employer?.trim()) && (row.normalizedMinSalary ?? 0) > 0;
}

function concentrationOf(employerCounts: ReadonlyMap<string, number>): EmployerConcentration {
    let postings = 0;
    let topEmployerPostings = 0;
    for (const count of employerCounts.values()) {
        postings += count;
        topEmployerPostings = Math.max(topEmployerPostings, count);
    }
    return { postings, employers: employerCounts.size, topEmployerPostings };
}

/**
 * Concentration per scope (row.state), for the per-state tables and the
 * per-city pass (which keys rows by city through the same field). Rows
 * outside the benchmark sample are ignored, exactly as summarizeBenchmarks
 * ignores them.
 */
export function employerConcentrationByScope(
    rows: readonly BenchmarkInputRow[],
): Map<string, EmployerConcentration> {
    const byScope = new Map<string, Map<string, number>>();
    for (const row of rows) {
        if (!isSampleRow(row)) continue;
        const key = employerKey(row.employer.trim());
        const counts = byScope.get(row.state) ?? new Map<string, number>();
        counts.set(key, (counts.get(key) ?? 0) + 1);
        byScope.set(row.state, counts);
    }
    return new Map([...byScope.entries()].map(([scope, counts]) => [scope, concentrationOf(counts)]));
}

/**
 * Concentration of one pool taken as a whole, whatever each row's state
 * (stateless rows count, as in the pooled national figure).
 */
export function employerConcentration(rows: readonly BenchmarkInputRow[]): EmployerConcentration {
    const pooled = rows.map((row) => ({ ...row, state: 'pool' }));
    return employerConcentrationByScope(pooled).get('pool') ?? EMPTY_CONCENTRATION;
}

/** True when no single employer holds more than MAX_EMPLOYER_SHARE_PERCENT of the sample. */
export function clearsEmployerShareCap(
    concentration: Pick<EmployerConcentration, 'postings' | 'topEmployerPostings'>,
): boolean {
    const { postings, topEmployerPostings } = concentration;
    return postings > 0 && topEmployerPostings * 100 <= postings * MAX_EMPLOYER_SHARE_PERCENT;
}

/** A scope that cleared the benchmark gate but not the employer-share cap. */
export interface HeldScope {
    scope: string;
    concentration: EmployerConcentration;
}

/**
 * A benchmark summary under the cap. `national` and `states` hold only
 * scopes that cleared BOTH the benchmark gate and the cap, so the type is a
 * drop-in BenchmarkSummary. The held fields name the scopes the cap alone
 * withheld, so a page can say why instead of calling a large sample "too
 * small".
 */
export interface CappedBenchmarkSummary extends BenchmarkSummary {
    /** States that cleared the benchmark gate but not the cap, in scope order. */
    heldStates: HeldScope[];
    /** The pooled row's concentration when the cap alone withheld it, else null. */
    nationalHeld: EmployerConcentration | null;
}

/**
 * Apply the cap to a benchmark summary computed from the same rows. The
 * national row is judged over every row the summary pooled (rows with a
 * scope, as summarizeBenchmarks pools them).
 */
export function applyEmployerShareCap(
    summary: BenchmarkSummary,
    rows: readonly BenchmarkInputRow[],
): CappedBenchmarkSummary {
    const byScope = employerConcentrationByScope(rows);
    const states: BenchmarkRow[] = [];
    const heldStates: HeldScope[] = [];
    for (const row of summary.states) {
        const concentration = byScope.get(row.scope) ?? EMPTY_CONCENTRATION;
        if (clearsEmployerShareCap(concentration)) states.push(row);
        else heldStates.push({ scope: row.scope, concentration });
    }
    if (!summary.national) return { national: null, states, heldStates, nationalHeld: null };
    const pooled = employerConcentration(rows.filter((row) => Boolean(row.state)));
    return clearsEmployerShareCap(pooled)
        ? { national: summary.national, states, heldStates, nationalHeld: null }
        : { national: null, states, heldStates, nationalHeld: pooled };
}

/**
 * summarizeBenchmarks under the employer-share cap: the publishing policy
 * every salary-guide surface uses. Same inputs, and the output is a
 * superset of BenchmarkSummary, so a caller switches by name alone.
 */
export function summarizeCappedBenchmarks(rows: readonly BenchmarkInputRow[]): CappedBenchmarkSummary {
    return applyEmployerShareCap(summarizeBenchmarks(rows), rows);
}

/**
 * The pooled figure for one sub-pool (a specialty tag, an experience bucket,
 * the whole board): every row counts, stateless ones included, exactly as
 * the pooled national figure is computed elsewhere.
 */
export function summarizeCappedPool(
    rows: readonly BenchmarkInputRow[],
): { national: BenchmarkRow | null; nationalHeld: EmployerConcentration | null } {
    const { national, nationalHeld } = summarizeCappedBenchmarks(
        rows.map((row) => ({ ...row, state: row.state ?? 'Unknown' })),
    );
    return { national, nationalHeld };
}

/**
 * summarizeBenchmarkPool under the cap: state rows over rows with a state,
 * and the national row over every row, stateless ones included.
 */
export function summarizeCappedBenchmarkPool(rows: readonly BenchmarkInputRow[]): BenchmarkSummary {
    const { states } = summarizeCappedBenchmarks(rows);
    const { national } = summarizeCappedPool(rows);
    return { national, states };
}

/**
 * The sentence a page prints when a scope is held by the cap. It names the
 * failing condition with the sample's own counts and never names the
 * employer or prints a figure.
 */
export function buildEmployerShareHoldSentence(input: {
    scopeName: string;
    concentration: EmployerConcentration;
}): string {
    const { scopeName, concentration } = input;
    return `${concentration.postings} postings in ${scopeName} disclose annual pay across ${concentration.employers} employers, `
        + `but one employer accounts for ${concentration.topEmployerPostings} of them. `
        + `This site publishes a median only when no single employer contributes more than ${MAX_EMPLOYER_SHARE_PERCENT}% of the postings behind it, `
        + 'so no figure is shown until the mix broadens.';
}

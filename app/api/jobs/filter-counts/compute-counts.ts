import type { Prisma } from '@prisma/client';
import type { FilterCounts, FilterState } from '@/types/filters';
import {
  FACET_KEYS,
  anySalaryClause,
  buildFacetClauses,
  buildWhereClause,
  clearFacets,
  minYearsQualifyClause,
  newGradWhereClause,
  postedWithinClause,
  salaryClause,
  telehealthSpecialtyClause,
  travelSpecialtyClause,
  workModeClause,
  type FacetKey,
} from '@/lib/filters';
import { buildSearchConditionSet, extractSearchQueryIntent } from '@/lib/search-query-intent';
import { isMemoryEvaluable, matchesWhere, type MemoryRow } from './where-evaluator';

/**
 * Filter-counts computation (P10 jobs #1).
 *
 * The old route issued ~21 COUNT queries, each re-running the full
 * GLOBAL_EXCLUSIONS predicate, through a two-connection pool: 12 to 19 s per
 * sidebar refresh. Now:
 *   1. ONE query fetches the facet-free result set (search, location,
 *      category, employer, exclusions) with only the columns the facets read.
 *   2. Any facet or badge clause that reads a column outside that set (the
 *      Telehealth description keywords) resolves with ONE id-only query each.
 *   3. Every badge is tallied in a single in-memory pass, evaluating the SAME
 *      clause objects buildWhereClause composes (lib/filters.ts facet
 *      builders), so counts cannot drift from the filters they preview.
 */

export const COUNT_ROW_SELECT = {
  id: true,
  title: true,
  isRemote: true,
  isHybrid: true,
  jobType: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
  createdAt: true,
  originalPostedAt: true,
  experienceLevel: true,
  minYearsExperience: true,
  newGradFriendly: true,
  categoryTags: true,
} as const satisfies Prisma.JobSelect;

export const COUNT_ROW_COLUMNS: ReadonlySet<string> = new Set(Object.keys(COUNT_ROW_SELECT));

export interface FilterCountsPlan {
  /** Facet-free WHERE: the one result set every badge is tallied over. */
  baseWhere: Prisma.JobWhereInput;
  /** Active facet clauses (inactive facets absent). */
  active: Partial<Record<FacetKey, Prisma.JobWhereInput>>;
  /**
   * The search's work-mode terms when an explicit Work Mode facet suppresses
   * them. Clearing that facet (to count its own options) re-enables them,
   * exactly as buildWhereClause({ ...filters, workMode: [] }) would.
   */
  searchWorkMode: Prisma.JobWhereInput | null;
  options: {
    remote: Prisma.JobWhereInput;
    hybrid: Prisma.JobWhereInput;
    onsite: Prisma.JobWhereInput;
    salaryAny: Prisma.JobWhereInput;
    salary100k: Prisma.JobWhereInput;
    salary150k: Prisma.JobWhereInput;
    salary200k: Prisma.JobWhereInput;
    posted24h: Prisma.JobWhereInput;
    posted3d: Prisma.JobWhereInput;
    posted7d: Prisma.JobWhereInput;
    posted30d: Prisma.JobWhereInput;
    telehealth: Prisma.JobWhereInput;
    travel: Prisma.JobWhereInput;
    newGrad: Prisma.JobWhereInput;
    minYears1: Prisma.JobWhereInput;
    minYears2: Prisma.JobWhereInput;
    minYears5: Prisma.JobWhereInput;
  };
  /** Clauses the in-memory evaluator cannot model: resolve each to an id set. */
  dbClauses: Prisma.JobWhereInput[];
}

export function planFilterCounts(filters: FilterState, now: Date = new Date()): FilterCountsPlan {
  const hasExplicitWorkMode = filters.workMode.length > 0;
  const baseWhere = buildWhereClause(clearFacets(filters), { hasExplicitWorkMode });
  const active = buildFacetClauses(filters, now);

  let searchWorkMode: Prisma.JobWhereInput | null = null;
  if (hasExplicitWorkMode && filters.search && filters.search.trim()) {
    searchWorkMode = buildSearchConditionSet(extractSearchQueryIntent(filters.search), {
      hasExplicitWorkMode: false,
      hasExplicitLocation: Boolean(filters.location || filters.stateCode),
    }).workMode;
  }

  const nonNull = (clause: Prisma.JobWhereInput | null): Prisma.JobWhereInput => clause ?? {};
  const options: FilterCountsPlan['options'] = {
    remote: nonNull(workModeClause(['remote'])),
    hybrid: nonNull(workModeClause(['hybrid'])),
    onsite: nonNull(workModeClause(['onsite'])),
    salaryAny: anySalaryClause(),
    salary100k: nonNull(salaryClause(100000)),
    salary150k: nonNull(salaryClause(150000)),
    salary200k: nonNull(salaryClause(200000)),
    posted24h: nonNull(postedWithinClause('24h', now)),
    posted3d: nonNull(postedWithinClause('3d', now)),
    posted7d: nonNull(postedWithinClause('7d', now)),
    posted30d: nonNull(postedWithinClause('30d', now)),
    telehealth: telehealthSpecialtyClause(),
    travel: travelSpecialtyClause(),
    newGrad: newGradWhereClause(),
    minYears1: minYearsQualifyClause(1),
    minYears2: minYearsQualifyClause(2),
    minYears5: minYearsQualifyClause(5),
  };

  const candidates: Prisma.JobWhereInput[] = [
    ...Object.values(active),
    ...(searchWorkMode ? [searchWorkMode] : []),
    ...Object.values(options),
  ];
  const dbClauses = candidates.filter((clause) => !isMemoryEvaluable(clause, COUNT_ROW_COLUMNS));

  return { baseWhere, active, searchWorkMode, options, dbClauses };
}

export type ClauseIdSets = ReadonlyMap<Prisma.JobWhereInput, ReadonlySet<string>>;

function matcher(idSets: ClauseIdSets) {
  return (clause: Prisma.JobWhereInput, row: MemoryRow): boolean => {
    const ids = idSets.get(clause);
    return ids ? ids.has(row.id) : matchesWhere(clause, row);
  };
}

const JOB_TYPE_KEYS = ['Full-Time', 'Part-Time', 'Contract', 'Per Diem'] as const;
const EXPERIENCE_LEVEL_KEYS = ['New Grad', 'Mid-Level', 'Senior'] as const;

function emptyCounts(): FilterCounts {
  return {
    workMode: { remote: 0, hybrid: 0, onsite: 0 },
    jobType: { 'Full-Time': 0, 'Part-Time': 0, 'Contract': 0, 'Per Diem': 0, 'Other': 0 },
    salary: { any: 0, over100k: 0, over150k: 0, over200k: 0 },
    postedWithin: { '24h': 0, '3d': 0, '7d': 0, '30d': 0 },
    specialty: { Telehealth: 0, Travel: 0 },
    experienceLevel: { 'New Grad': 0, 'Mid-Level': 0, 'Senior': 0 },
    newGradFriendly: 0,
    minYears: { 1: 0, 2: 0, 5: 0 },
    total: 0,
  };
}

/**
 * Tally every badge over the facet-free rows. A facet's own options are
 * counted with every OTHER active facet applied (a badge never self-filters),
 * matching the per-facet bases the COUNT implementation used.
 */
export function tallyFilterCounts(
  rows: readonly MemoryRow[],
  plan: FilterCountsPlan,
  idSets: ClauseIdSets = new Map(),
): FilterCounts {
  const matches = matcher(idSets);
  const counts = emptyCounts();
  const { options } = plan;

  for (const row of rows) {
    const failing = FACET_KEYS.filter((key) => {
      const clause = plan.active[key];
      return clause !== undefined && !matches(clause, row);
    });
    if (failing.length > 1) continue;
    const onlyFails = failing[0] as FacetKey | undefined;
    const passesExcept = (key: FacetKey) => onlyFails === undefined || onlyFails === key;

    if (onlyFails === undefined) counts.total += 1;

    if (passesExcept('workMode') && (!plan.searchWorkMode || matches(plan.searchWorkMode, row))) {
      if (matches(options.remote, row)) counts.workMode.remote += 1;
      if (matches(options.hybrid, row)) counts.workMode.hybrid += 1;
      if (matches(options.onsite, row)) counts.workMode.onsite += 1;
    }
    if (passesExcept('jobType')) {
      const jobType = row.jobType;
      if (jobType === null || jobType === undefined) counts.jobType.Other += 1;
      else if ((JOB_TYPE_KEYS as readonly unknown[]).includes(jobType)) {
        counts.jobType[jobType as (typeof JOB_TYPE_KEYS)[number]] += 1;
      }
    }
    if (passesExcept('salary')) {
      if (matches(options.salaryAny, row)) counts.salary.any += 1;
      if (matches(options.salary100k, row)) counts.salary.over100k += 1;
      if (matches(options.salary150k, row)) counts.salary.over150k += 1;
      if (matches(options.salary200k, row)) counts.salary.over200k += 1;
    }
    if (passesExcept('postedWithin')) {
      if (matches(options.posted24h, row)) counts.postedWithin['24h'] += 1;
      if (matches(options.posted3d, row)) counts.postedWithin['3d'] += 1;
      if (matches(options.posted7d, row)) counts.postedWithin['7d'] += 1;
      if (matches(options.posted30d, row)) counts.postedWithin['30d'] += 1;
    }
    if (passesExcept('specialty')) {
      if (matches(options.telehealth, row)) counts.specialty.Telehealth += 1;
      if (matches(options.travel, row)) counts.specialty.Travel += 1;
    }
    if (passesExcept('experienceLevel')) {
      const level = row.experienceLevel;
      if ((EXPERIENCE_LEVEL_KEYS as readonly unknown[]).includes(level)) {
        counts.experienceLevel[level as (typeof EXPERIENCE_LEVEL_KEYS)[number]] += 1;
      }
    }
    if (passesExcept('newGrad') && matches(options.newGrad, row)) counts.newGradFriendly += 1;
    if (passesExcept('minYears')) {
      if (matches(options.minYears1, row)) counts.minYears[1] += 1;
      if (matches(options.minYears2, row)) counts.minYears[2] += 1;
      if (matches(options.minYears5, row)) counts.minYears[5] += 1;
    }
  }
  return counts;
}

export interface FilterCountsDataSource {
  /** Rows matching `where`, with COUNT_ROW_SELECT columns. */
  findRows: (where: Prisma.JobWhereInput) => Promise<MemoryRow[]>;
  /** Ids of rows matching `where`. */
  findIds: (where: Prisma.JobWhereInput) => Promise<string[]>;
}

export async function computeFilterCounts(
  filters: FilterState,
  source: FilterCountsDataSource,
  now: Date = new Date(),
): Promise<FilterCounts> {
  const plan = planFilterCounts(filters, now);
  const [rows, ...idLists] = await Promise.all([
    source.findRows(plan.baseWhere),
    ...plan.dbClauses.map((clause) => source.findIds({ AND: [plan.baseWhere, clause] })),
  ]);
  const idSets = new Map<Prisma.JobWhereInput, ReadonlySet<string>>(
    plan.dbClauses.map((clause, i) => [clause, new Set(idLists[i])]),
  );
  return tallyFilterCounts(rows, plan, idSets);
}

/* ─── Request body normalization ───────────────────────────────────────── */

const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 500;

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.slice(0, MAX_STRING_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => item.slice(0, MAX_STRING_LENGTH));
}

function nonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Coerce an untrusted POST body into a FilterState. Wrong-typed fields fall
 * back to "inactive" instead of reaching Prisma (a string salaryMin used to
 * throw inside the query and answer 500). Returns null for a non-object body.
 */
export function normalizeFilterCountsBody(raw: unknown): FilterState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const minYears = nonNegativeNumber(body.minYearsExperience);
  return {
    search: stringValue(body.search) ?? '',
    workMode: stringArray(body.workMode),
    jobType: stringArray(body.jobType),
    specialty: stringArray(body.specialty),
    experienceLevel: stringArray(body.experienceLevel),
    newGradFriendly: body.newGradFriendly === true ? true : null,
    minYearsExperience: typeof body.minYearsExperience === 'number' ? minYears : null,
    salaryMin: nonNegativeNumber(body.salaryMin),
    postedWithin: stringValue(body.postedWithin),
    location: stringValue(body.location),
    cityExact: stringValue(body.cityExact),
    stateCode: stringValue(body.stateCode),
    employer: stringValue(body.employer),
    category: stringValue(body.category),
  };
}

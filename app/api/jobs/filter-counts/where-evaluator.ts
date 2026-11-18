/**
 * In-memory evaluator for the subset of Prisma `JobWhereInput` the /jobs
 * facet builders in lib/filters.ts emit. It lets POST /api/jobs/filter-counts
 * fetch the facet-free result set ONCE and tally every badge in a single
 * pass, instead of issuing ~20 COUNT queries through a two-connection pool
 * (the 12 to 19 s latency defect).
 *
 * Semantics mirror the SQL Prisma generates for PostgreSQL, including SQL
 * three-valued logic: a comparison against a NULL column is UNKNOWN, NOT
 * UNKNOWN stays UNKNOWN, and a row matches only when the whole clause is
 * TRUE. Any operator or column this evaluator does not model makes
 * `isMemoryEvaluable` return false, and the caller resolves that clause with
 * a database query instead, so an unsupported shape can never be guessed at.
 *
 * To-one relation filters (`company: { is: null }`, `company: { is: {...} }`)
 * are evaluated against the related row the caller loaded as a nested object
 * (null when there is none). Their nested columns are named
 * `<relation>.<column>` in the column set. Under NOT they go to the database:
 * there SQL's answer for a row without the relation depends on the subquery
 * Prisma writes.
 */

type Tri = boolean | null;

export type MemoryRow = { id: string } & Record<string, unknown>;

type Fields = Record<string, unknown>;

const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT']);

const SUPPORTED_OPS = new Set([
  'equals', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte',
  'contains', 'startsWith', 'endsWith', 'mode', 'not', 'has', 'isEmpty',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

function isFieldFilterEvaluable(filter: unknown): boolean {
  if (filter === null || isScalar(filter)) return true;
  if (!isPlainObject(filter)) return false;
  for (const [op, operand] of Object.entries(filter)) {
    if (!SUPPORTED_OPS.has(op)) return false;
    if (op === 'mode' && operand !== 'insensitive' && operand !== 'default') return false;
    // `not: <value>` has nullable-column subtleties; only IS NOT NULL is modelled.
    if (op === 'not' && operand !== null) return false;
    if ((op === 'in' || op === 'notIn') && !(Array.isArray(operand) && operand.every(isScalar))) return false;
    if (op === 'isEmpty' && typeof operand !== 'boolean') return false;
    if (!['mode', 'not', 'in', 'notIn', 'isEmpty'].includes(op) && !isScalar(operand)) return false;
  }
  return true;
}

/** A to-one relation filter: `{ is: ... }` or `{ isNot: ... }` on a relation key. */
function isRelationFilter(value: unknown): value is Fields {
  return isPlainObject(value) && ('is' in value || 'isNot' in value);
}

/** The relation's own columns: `company.recruitmentType` becomes `recruitmentType`. */
function relationColumns(relation: string, columns: ReadonlySet<string>): ReadonlySet<string> {
  const prefix = `${relation}.`;
  return new Set([...columns].filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length)));
}

function isRelationFilterEvaluable(relation: string, filter: Fields, columns: ReadonlySet<string>): boolean {
  const ops = Object.keys(filter).filter((op) => filter[op] !== undefined);
  if (ops.length !== 1 || ops[0] !== 'is') return false;
  return filter.is === null || evaluable(filter.is, relationColumns(relation, columns), false);
}

function evaluable(clause: unknown, columns: ReadonlySet<string>, negated: boolean): boolean {
  if (!isPlainObject(clause)) return false;
  for (const [key, value] of Object.entries(clause)) {
    if (value === undefined) continue;
    if (LOGICAL_KEYS.has(key)) {
      const children = Array.isArray(value) ? value : [value];
      if (key === 'OR' && !Array.isArray(value)) return false;
      const childNegated = negated || key === 'NOT';
      if (!children.every((child) => evaluable(child, columns, childNegated))) return false;
      continue;
    }
    if (!columns.has(key)) return false;
    if (isRelationFilter(value)) {
      if (negated || !isRelationFilterEvaluable(key, value, columns)) return false;
      continue;
    }
    if (!isFieldFilterEvaluable(value)) return false;
  }
  return true;
}

/** True when every node of `clause` can be evaluated against `columns`. */
export function isMemoryEvaluable(clause: unknown, columns: ReadonlySet<string>): boolean {
  return evaluable(clause, columns, false);
}

/*
 * Evaluation compiles each clause once into a predicate, cached per clause
 * object, so the counts route walks a clause's structure once per request
 * instead of once per row (6,000+ rows times every badge). Clause objects
 * must not be mutated after they are evaluated.
 *
 * AND, OR and NOT stop at the first child that decides them (FALSE for AND,
 * TRUE for OR, TRUE for NOT): three-valued logic gives the same answer
 * whatever the remaining children are. A tagged row thus skips the title
 * keywords of every category's legacy arm, which only untagged rows read.
 */

type Predicate = (row: Fields) => Tri;
type ColumnTest = (column: unknown) => Tri;

const compiledClauses = new WeakMap<object, Predicate>();

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function comparable(value: unknown, insensitive: boolean): unknown {
  if (value instanceof Date) return value.getTime();
  if (insensitive && typeof value === 'string') return value.toLowerCase();
  return value;
}

function compareOp(op: string, column: unknown, operand: unknown): Tri {
  const a = comparable(column, false) as number | string;
  const b = comparable(operand, false) as number | string;
  switch (op) {
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'gt': return a > b;
    case 'gte': return a >= b;
    default: return null;
  }
}

function compileStringOp(op: string, operand: unknown, insensitive: boolean): ColumnTest {
  if (typeof operand !== 'string') return () => null;
  const needle = insensitive ? operand.toLowerCase() : operand;
  const test =
    op === 'contains' ? (h: string) => h.includes(needle)
      : op === 'startsWith' ? (h: string) => h.startsWith(needle)
        : (h: string) => h.endsWith(needle);
  return (column) => {
    if (typeof column !== 'string') return null;
    return test(insensitive ? column.toLowerCase() : column);
  };
}

function compileOperator(op: string, operand: unknown, insensitive: boolean): ColumnTest {
  switch (op) {
    case 'not':
      return (column) => !isNullish(column); // only `not: null` is evaluable
    case 'equals': {
      if (operand === null) return (column) => isNullish(column);
      const target = comparable(operand, insensitive);
      return (column) => (isNullish(column) ? null : comparable(column, insensitive) === target);
    }
    case 'in':
    case 'notIn': {
      const values = (operand as unknown[]).map((v) => comparable(v, insensitive));
      const wanted = op === 'in';
      return (column) => {
        if (isNullish(column)) return null;
        const needle = comparable(column, insensitive);
        return values.some((v) => v === needle) === wanted;
      };
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return (column) => (isNullish(column) ? null : compareOp(op, column, operand));
    case 'contains':
    case 'startsWith':
    case 'endsWith':
      return compileStringOp(op, operand, insensitive);
    case 'has':
      return (column) => (Array.isArray(column) ? column.includes(operand) : null);
    case 'isEmpty':
      return (column) => (Array.isArray(column) ? (column.length === 0) === operand : null);
    default:
      return () => null;
  }
}

function compileField(key: string, filter: unknown): Predicate {
  if (filter === null) return (row) => isNullish(row[key]);
  if (isScalar(filter)) {
    const test = compileOperator('equals', filter, false);
    return (row) => test(row[key]);
  }
  const ops = filter as Fields;
  const insensitive = ops.mode === 'insensitive';
  const tests = Object.entries(ops)
    .filter(([op, operand]) => op !== 'mode' && operand !== undefined)
    .map(([op, operand]) => compileOperator(op, operand, insensitive));
  return (row) => {
    const column = row[key];
    let unknown = false;
    for (const test of tests) {
      const v = test(column);
      if (v === false) return false;
      if (v === null) unknown = true;
    }
    return unknown ? null : true;
  };
}

function allOf(parts: readonly Predicate[]): Predicate {
  if (parts.length === 1) return parts[0];
  return (row) => {
    let unknown = false;
    for (const part of parts) {
      const v = part(row);
      if (v === false) return false;
      if (v === null) unknown = true;
    }
    return unknown ? null : true;
  };
}

function anyOf(parts: readonly Predicate[]): Predicate {
  if (parts.length === 1) return parts[0];
  return (row) => {
    let unknown = false;
    for (const part of parts) {
      const v = part(row);
      if (v === true) return true;
      if (v === null) unknown = true;
    }
    return unknown ? null : false;
  };
}

/** `NOT: [a, b]` is `NOT a AND NOT b`. */
function noneOf(parts: readonly Predicate[]): Predicate {
  return (row) => {
    let unknown = false;
    for (const part of parts) {
      const v = part(row);
      if (v === true) return false;
      if (v === null) unknown = true;
    }
    return unknown ? null : true;
  };
}

/** `is: null` matches a row without the relation; `is: {...}` a related row that matches. */
function compileRelation(key: string, filter: Fields): Predicate {
  if (filter.is === null) return (row) => !isPlainObject(row[key]);
  if (!isPlainObject(filter.is)) return () => null;
  const nested = compileClause(filter.is);
  return (row) => {
    const related = row[key];
    return isPlainObject(related) && nested(related) === true;
  };
}

function compileChildren(value: unknown): Predicate[] {
  return (Array.isArray(value) ? value : [value]).map((child) => compileClause(child as Fields));
}

function compileEntry(key: string, value: unknown): Predicate {
  if (key === 'AND') return allOf(compileChildren(value));
  if (key === 'OR') return anyOf(compileChildren(value));
  if (key === 'NOT') return noneOf(compileChildren(value));
  if (isRelationFilter(value)) return compileRelation(key, value);
  return compileField(key, value);
}

function compileClause(clause: Fields): Predicate {
  const cached = compiledClauses.get(clause);
  if (cached) return cached;
  const predicate = allOf(
    Object.entries(clause)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => compileEntry(key, value)),
  );
  compiledClauses.set(clause, predicate);
  return predicate;
}

/**
 * Whether `row` matches `clause` (SQL WHERE semantics: only TRUE matches).
 * Callers must have checked `isMemoryEvaluable` first.
 */
export function matchesWhere(clause: object, row: MemoryRow): boolean {
  return compileClause(clause as Fields)(row) === true;
}

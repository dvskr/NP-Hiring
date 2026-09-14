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
 */

type Tri = boolean | null;

export type MemoryRow = { id: string } & Record<string, unknown>;

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

/** True when every node of `clause` can be evaluated against `columns`. */
export function isMemoryEvaluable(clause: unknown, columns: ReadonlySet<string>): boolean {
  if (!isPlainObject(clause)) return false;
  for (const [key, value] of Object.entries(clause)) {
    if (value === undefined) continue;
    if (LOGICAL_KEYS.has(key)) {
      const children = Array.isArray(value) ? value : [value];
      if (key === 'OR' && !Array.isArray(value)) return false;
      if (!children.every((child) => isMemoryEvaluable(child, columns))) return false;
      continue;
    }
    if (!columns.has(key)) return false;
    if (!isFieldFilterEvaluable(value)) return false;
  }
  return true;
}

function triAnd(values: Iterable<Tri>): Tri {
  let unknown = false;
  for (const v of values) {
    if (v === false) return false;
    if (v === null) unknown = true;
  }
  return unknown ? null : true;
}

function triOr(values: Iterable<Tri>): Tri {
  let unknown = false;
  for (const v of values) {
    if (v === true) return true;
    if (v === null) unknown = true;
  }
  return unknown ? null : false;
}

function triNot(value: Tri): Tri {
  return value === null ? null : !value;
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

function stringOp(op: string, column: unknown, operand: unknown, insensitive: boolean): Tri {
  if (typeof column !== 'string' || typeof operand !== 'string') return null;
  const haystack = insensitive ? column.toLowerCase() : column;
  const needle = insensitive ? operand.toLowerCase() : operand;
  if (op === 'contains') return haystack.includes(needle);
  if (op === 'startsWith') return haystack.startsWith(needle);
  return haystack.endsWith(needle);
}

function evaluateOperator(op: string, operand: unknown, column: unknown, insensitive: boolean): Tri {
  const isNull = column === null || column === undefined;
  if (op === 'not') return !isNull; // only `not: null` is evaluable
  if (op === 'equals') {
    if (operand === null) return isNull;
    return isNull ? null : comparable(column, insensitive) === comparable(operand, insensitive);
  }
  if (isNull) return null;
  switch (op) {
    case 'in':
    case 'notIn': {
      const needle = comparable(column, insensitive);
      const found = (operand as unknown[]).some((v) => comparable(v, insensitive) === needle);
      return op === 'in' ? found : !found;
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return compareOp(op, column, operand);
    case 'contains':
    case 'startsWith':
    case 'endsWith':
      return stringOp(op, column, operand, insensitive);
    case 'has':
      return Array.isArray(column) ? column.includes(operand) : null;
    case 'isEmpty':
      return Array.isArray(column) ? (column.length === 0) === operand : null;
    default:
      return null;
  }
}

function evaluateField(filter: unknown, column: unknown): Tri {
  if (filter === null) return column === null || column === undefined;
  if (isScalar(filter)) return evaluateOperator('equals', filter, column, false);
  const ops = filter as Record<string, unknown>;
  const insensitive = ops.mode === 'insensitive';
  return triAnd(
    Object.entries(ops)
      .filter(([op, operand]) => op !== 'mode' && operand !== undefined)
      .map(([op, operand]) => evaluateOperator(op, operand, column, insensitive)),
  );
}

function evaluateTri(clause: Record<string, unknown>, row: MemoryRow): Tri {
  const parts: Tri[] = [];
  for (const [key, value] of Object.entries(clause)) {
    if (value === undefined) continue;
    if (key === 'AND') {
      const children = Array.isArray(value) ? value : [value];
      parts.push(triAnd(children.map((c) => evaluateTri(c as Record<string, unknown>, row))));
    } else if (key === 'OR') {
      parts.push(triOr((value as unknown[]).map((c) => evaluateTri(c as Record<string, unknown>, row))));
    } else if (key === 'NOT') {
      const children = Array.isArray(value) ? value : [value];
      parts.push(triAnd(children.map((c) => triNot(evaluateTri(c as Record<string, unknown>, row)))));
    } else {
      parts.push(evaluateField(value, row[key]));
    }
  }
  return triAnd(parts);
}

/**
 * Whether `row` matches `clause` (SQL WHERE semantics: only TRUE matches).
 * Callers must have checked `isMemoryEvaluable` first.
 */
export function matchesWhere(clause: object, row: MemoryRow): boolean {
  return evaluateTri(clause as Record<string, unknown>, row) === true;
}

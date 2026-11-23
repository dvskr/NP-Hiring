/**
 * An in-memory stand-in for the slice of Prisma's query language the job read
 * paths use, so a test can run the real where clauses (publicJobsWhere and
 * whatever is built on it) against fixture rows instead of pinning their
 * shape.
 *
 * Strict on purpose: an operator it does not know throws, so a clause it
 * cannot evaluate fails the test instead of quietly matching everything.
 * Two simplifications, both safe for fixtures that set every field a clause
 * reads: ordering is not modelled (list fixtures in the order the query asks
 * for), and neither is SQL's NULL logic. `take` is modelled, because it
 * decides which rows a capped read can return.
 */

export type Row = Record<string, unknown>;
type Clause = Record<string, unknown>;

export interface FakeTables {
  jobs: Row[];
  recommendations?: Row[];
}

type Model = 'job' | 'candidateRecommendation';

interface Relation {
  model: Model;
  load: (row: Row, tables: FakeTables) => Row | Row[] | null;
}

const RELATIONS: Record<Model, Record<string, Relation>> = {
  job: {
    shadowedBy: {
      model: 'job',
      load: (row, tables) => tables.jobs.find((job) => job.id === row.shadowedByJobId) ?? null,
    },
    shadowedCopies: {
      model: 'job',
      load: (row, tables) => tables.jobs.filter((job) => job.shadowedByJobId === row.id),
    },
  },
  candidateRecommendation: {
    job: {
      model: 'job',
      load: (row, tables) => tables.jobs.find((job) => job.id === row.jobId) ?? null,
    },
  },
};

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function compare(value: unknown, arg: unknown, test: (a: number, b: number) => boolean): boolean {
  if (value === null || value === undefined) return false;
  return test(Number(value instanceof Date ? value.getTime() : value), Number(arg instanceof Date ? arg.getTime() : arg));
}

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date || typeof cond !== 'object') return same(value, cond);
  const ops = cond as Clause;
  const insensitive = ops.mode === 'insensitive';
  // A text operator under mode 'insensitive' compares both sides in lower case, as PostgreSQL's ILIKE does.
  const text = (operand: unknown): string | null => (typeof operand === 'string' ? (insensitive ? operand.toLowerCase() : operand) : null);
  const sameText = (a: unknown, b: unknown): boolean => {
    const left = text(a);
    const right = text(b);
    return left !== null && right !== null ? left === right : same(a, b);
  };
  return Object.entries(ops).every(([op, arg]) => {
    switch (op) {
      case 'equals': return sameText(value, arg);
      case 'not': return arg === null ? value !== null && value !== undefined : !fieldMatches(value, arg);
      case 'in': return (arg as unknown[]).some((item) => sameText(value, item));
      case 'notIn': return !(arg as unknown[]).some((item) => sameText(value, item));
      case 'gt': return compare(value, arg, (a, b) => a > b);
      case 'gte': return compare(value, arg, (a, b) => a >= b);
      case 'lt': return compare(value, arg, (a, b) => a < b);
      case 'lte': return compare(value, arg, (a, b) => a <= b);
      case 'contains': {
        const haystack = text(value);
        return haystack !== null && haystack.includes(text(String(arg)) ?? '');
      }
      case 'startsWith': {
        const haystack = text(value);
        return haystack !== null && haystack.startsWith(text(String(arg)) ?? '');
      }
      case 'endsWith': {
        const haystack = text(value);
        return haystack !== null && haystack.endsWith(text(String(arg)) ?? '');
      }
      case 'mode': return true;
      default: throw new Error(`fake prisma: unsupported operator "${op}"`);
    }
  });
}

function asList(cond: unknown): unknown[] {
  return Array.isArray(cond) ? cond : [cond];
}

function oneRelationMatches(related: Row | null, cond: unknown, model: Model, tables: FakeTables): boolean {
  if (cond === null) return related === null;
  const filter = cond as Clause;
  if ('is' in filter) {
    return filter.is === null ? related === null : related !== null && matchesWhere(model, related, filter.is, tables);
  }
  if ('isNot' in filter) {
    return filter.isNot === null ? related !== null : related === null || !matchesWhere(model, related, filter.isNot, tables);
  }
  return related !== null && matchesWhere(model, related, filter, tables);
}

function listRelationMatches(related: Row[], cond: Clause, model: Model, tables: FakeTables): boolean {
  if ('some' in cond) return related.some((row) => matchesWhere(model, row, cond.some, tables));
  if ('none' in cond) return !related.some((row) => matchesWhere(model, row, cond.none, tables));
  if ('every' in cond) return related.every((row) => matchesWhere(model, row, cond.every, tables));
  throw new Error('fake prisma: a list relation filter needs some, none or every');
}

/** Whether `row` satisfies a Prisma where clause for `model`. */
export function matchesWhere(model: Model, row: Row, where: unknown, tables: FakeTables): boolean {
  if (where === undefined) return true;
  return Object.entries(where as Clause).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'AND') return asList(cond).every((clause) => matchesWhere(model, row, clause, tables));
    if (key === 'OR') return (cond as unknown[]).some((clause) => matchesWhere(model, row, clause, tables));
    if (key === 'NOT') return asList(cond).every((clause) => !matchesWhere(model, row, clause, tables));
    const relation = RELATIONS[model][key];
    if (!relation) return fieldMatches(row[key], cond);
    const related = relation.load(row, tables);
    return Array.isArray(related)
      ? listRelationMatches(related, cond as Clause, relation.model, tables)
      : oneRelationMatches(related, cond, relation.model, tables);
  });
}

interface Shape {
  select?: Clause;
  include?: Clause;
  where?: unknown;
}

/** Applies a select or include, following the relations above. Other nested fields are copied as stored. */
function project(model: Model, row: Row, shape: Shape, tables: FakeTables): Row {
  const spec = shape.select ?? shape.include;
  if (!spec) return { ...row };
  const out: Row = shape.include ? { ...row } : {};
  for (const [key, value] of Object.entries(spec)) {
    if (!value) continue;
    const relation = RELATIONS[model][key];
    if (!relation) {
      out[key] = row[key];
      continue;
    }
    const nested: Shape = value === true ? {} : (value as Shape);
    const related = relation.load(row, tables);
    out[key] = Array.isArray(related)
      ? related
          .filter((item) => matchesWhere(relation.model, item, nested.where, tables))
          .map((item) => project(relation.model, item, nested, tables))
      : related && project(relation.model, related, nested, tables);
  }
  return out;
}

export interface FindArgs extends Shape {
  take?: number;
}

/** findMany and findFirst over one fake table. Tables are read at call time, so a test can swap rows. */
export function fakeModel(model: Model, tables: FakeTables) {
  const rowsOf = (): Row[] => (model === 'job' ? tables.jobs : tables.recommendations ?? []);
  const findMany = async (args: FindArgs = {}): Promise<Row[]> => {
    const rows = rowsOf().filter((row) => matchesWhere(model, row, args.where, tables));
    return rows.slice(0, args.take ?? rows.length).map((row) => project(model, row, args, tables));
  };
  const findFirst = async (args: FindArgs = {}): Promise<Row | null> =>
    (await findMany({ ...args, take: 1 }))[0] ?? null;
  return { findMany, findFirst };
}

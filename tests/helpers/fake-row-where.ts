/**
 * A strict, in-memory reading of the slice of Prisma's where language the
 * employer candidate routes use, so a test can run a route's real where
 * clause against fixture rows instead of pinning its shape.
 *
 * An operator it does not know throws, so a clause it cannot evaluate fails
 * the test instead of quietly matching. To-one relations are resolved by the
 * caller (`relations`), as a direct where or `{ is }`. SQL's NULL logic is not
 * modelled: fixtures set every field a clause reads.
 */

export type Row = Record<string, unknown>;
export type Relations = Record<string, (row: Row) => Row | null>;

function same(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b;
}

function compare(value: unknown, arg: unknown, test: (a: number, b: number) => boolean): boolean {
    if (value === null || value === undefined) return false;
    const n = (v: unknown) => Number(v instanceof Date ? v.getTime() : v);
    return test(n(value), n(arg));
}

function fieldMatches(value: unknown, cond: unknown): boolean {
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date || typeof cond !== 'object') return same(value, cond);
    const ops = cond as Row;
    const insensitive = ops.mode === 'insensitive';
    return Object.entries(ops).every(([op, arg]) => {
        switch (op) {
            case 'equals': return same(value, arg);
            case 'not': return arg === null ? value !== null && value !== undefined : !fieldMatches(value, arg);
            case 'in': return (arg as unknown[]).some((item) => same(value, item));
            case 'gt': return compare(value, arg, (a, b) => a > b);
            case 'gte': return compare(value, arg, (a, b) => a >= b);
            case 'lt': return compare(value, arg, (a, b) => a < b);
            case 'lte': return compare(value, arg, (a, b) => a <= b);
            case 'contains':
                if (typeof value !== 'string') return false;
                return insensitive
                    ? value.toLowerCase().includes(String(arg).toLowerCase())
                    : value.includes(String(arg));
            case 'mode': return true;
            default: throw new Error(`fake where: unsupported operator "${op}"`);
        }
    });
}

const asList = (cond: unknown): unknown[] => (Array.isArray(cond) ? cond : [cond]);

/** Whether `row` satisfies a Prisma where clause. */
export function rowMatches(row: Row, where: unknown, relations: Relations = {}): boolean {
    if (where === undefined) return true;
    return Object.entries(where as Row).every(([key, cond]) => {
        if (cond === undefined) return true;
        if (key === 'AND') return asList(cond).every((c) => rowMatches(row, c, relations));
        if (key === 'OR') return (cond as unknown[]).some((c) => rowMatches(row, c, relations));
        if (key === 'NOT') return asList(cond).every((c) => !rowMatches(row, c, relations));
        const relation = relations[key];
        if (!relation) return fieldMatches(row[key], cond);
        const related = relation(row);
        const filter = cond as Row;
        if (cond !== null && 'is' in filter) return related !== null && rowMatches(related, filter.is);
        return related !== null && rowMatches(related, cond);
    });
}

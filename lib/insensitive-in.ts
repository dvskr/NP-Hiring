/**
 * A case-insensitive `in` filter for Prisma that matches on PostgreSQL.
 *
 * Prisma with @prisma/adapter-pg compiles `{ in: values, mode: 'insensitive' }`
 * to `LOWER("column") IN ($1, ...)` and binds the values exactly as given, so a
 * capitalised value never matches anything: the column side is lowered and
 * the value side is not.
 *
 * Lowering the values here makes both sides lower case. It stays correct if a
 * later Prisma lowers the bound values itself, because lowering twice changes
 * nothing.
 */
export function insensitiveIn(values: readonly string[]): { in: string[]; mode: 'insensitive' } {
    return { in: values.map((value) => value.toLowerCase()), mode: 'insensitive' };
}

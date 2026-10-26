/**
 * JSON body guards for routes whose body values reach a Prisma where clause.
 *
 * A parsed JSON field can be an object or an array, and Prisma reads an
 * object in a non-unique where clause (findFirst, findMany, count,
 * updateMany, deleteMany) as a filter, not an equality: { "not": "" }
 * matches every row and { "startsWith": "a" } turns a secret check into a
 * guessing oracle. A route that compares a body value against a secret, or
 * uses it as the only lookup key, reads it through stringField first and
 * answers 400 when it is not a plain string
 * (tests/regressions/edit-token-body-type.test.ts).
 */

/** Longest body string stringField accepts unless the caller sets its own limit. */
export const DEFAULT_MAX_STRING_FIELD_LENGTH = 200;

/**
 * The request body when it is a JSON object, else null: malformed JSON, an
 * empty body, null, an array or a bare primitive all read as null, so the
 * caller answers 400 instead of throwing a 500.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
    let parsed: unknown;
    try {
        parsed = await request.json();
    } catch {
        return null;
    }
    return asJsonObject(parsed);
}

/**
 * A parsed JSON value when it is an object, else null (null, an array or a
 * bare primitive). For a route that has to read the body as text first, for
 * example to cap its size before parsing it.
 */
export function asJsonObject(parsed: unknown): Record<string, unknown> | null {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
}

/** The value when it is a non-empty string no longer than maxLength, else null. */
export function stringField(value: unknown, maxLength: number = DEFAULT_MAX_STRING_FIELD_LENGTH): string | null {
    if (typeof value !== 'string') return null;
    if (value.length === 0 || value.length > maxLength) return null;
    return value;
}

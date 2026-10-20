/**
 * Shared request-input helpers for the autofill routes.
 *
 * Every autofill route authenticates with an extension token and then reads
 * a JSON body the Chrome extension built from a third-party page. Prisma
 * runs with the service role, so the handler is the only check between that
 * body and the database or the model prompt. These helpers turn untrusted
 * values into bounded, typed ones and never throw: a wrong type becomes a
 * default and a long string is cut, so a real extension request is never
 * rejected for size.
 */

/** Job context read from the page. The caps generate-answer has used since audit B96. */
export const MAX_JOB_TITLE_CHARS = 300;
export const MAX_EMPLOYER_NAME_CHARS = 300;
export const MAX_JOB_DESCRIPTION_CHARS = 20_000;

/** True for a JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` cut to `maxChars` with NUL characters removed (Postgres rejects
 * them in TEXT columns, which failed the whole insert); '' when `value` is
 * not a string. A cut never ends on half of a surrogate pair.
 */
export function cleanText(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    let text = value.length > maxChars ? value.slice(0, maxChars) : value;
    if (text.length < value.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    return text.replaceAll('\u0000', '');
}

/** A finite number truncated to an integer and clamped to min..max; `fallback` for anything else. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

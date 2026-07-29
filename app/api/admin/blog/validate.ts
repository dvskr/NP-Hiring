/**
 * Shared validation for the two editorially-authored schema fields the
 * admin blog editor writes (audit fix: the editor previously could not
 * author faq_json or reviewed_at at all — both feed structured data on
 * the public post page, so malformed input must fail loudly, not save).
 */

export interface FaqEntry {
    name: string;
    text: string;
}

/**
 * Validate a faqJson payload. Returns:
 *   - { ok: true, value } with a sanitized array (or null to clear)
 *   - { ok: false, error } when the shape is wrong
 */
export function parseFaqJson(
    input: unknown,
): { ok: true; value: FaqEntry[] | null } | { ok: false; error: string } {
    if (input === null || input === undefined) return { ok: true, value: null };
    if (!Array.isArray(input)) {
        return { ok: false, error: 'faqJson must be an array of { name, text } objects or null' };
    }
    const value: FaqEntry[] = [];
    for (const entry of input) {
        if (
            !entry || typeof entry !== 'object' ||
            typeof (entry as FaqEntry).name !== 'string' ||
            typeof (entry as FaqEntry).text !== 'string' ||
            !(entry as FaqEntry).name.trim() ||
            !(entry as FaqEntry).text.trim()
        ) {
            return { ok: false, error: 'each faqJson entry needs non-empty string "name" and "text"' };
        }
        value.push({
            name: (entry as FaqEntry).name.trim(),
            text: (entry as FaqEntry).text.trim(),
        });
    }
    return { ok: true, value: value.length > 0 ? value : null };
}

/**
 * Validate a reviewedAt payload (ISO/date string or null to clear).
 */
export function parseReviewedAt(
    input: unknown,
): { ok: true; value: Date | null } | { ok: false; error: string } {
    if (input === null || input === undefined || input === '') return { ok: true, value: null };
    if (typeof input !== 'string') {
        return { ok: false, error: 'reviewedAt must be a date string or null' };
    }
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
        return { ok: false, error: `reviewedAt '${input}' is not a valid date` };
    }
    return { ok: true, value: date };
}

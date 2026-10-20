/**
 * Request parsing for POST /api/autofill/classify-fields.
 *
 * SECURITY (AUTOFILL-CLASSIFY-1): placeholder, fieldType, options, attribute
 * values, jobTitle and employerName went into the model prompt with no
 * length or count cap, so one call (counted as one generation) could carry
 * megabytes of page text. A non-string label or a string `options` answered
 * 500, and the field-clustering patterns in the route ran over the uncut
 * strings, which is quadratic on a long repeated keyword. The body is now cut
 * here, before clustering, and nothing is rejected for size: the extension
 * sends raw page values (every option of a native select, ten attributes
 * including class, labels of any length), so a hard limit would fail whole
 * forms. Options get a per-field and a per-request budget sized well above
 * real state, country and year lists; a list that had to be cut is marked so
 * the prompt does not demand an exact match from it.
 * Test: tests/api/autofill-classify-input.test.ts
 */

import {
    MAX_EMPLOYER_NAME_CHARS,
    MAX_JOB_DESCRIPTION_CHARS,
    MAX_JOB_TITLE_CHARS,
    cleanText,
    isRecord,
} from './input';

export interface FieldToClassify {
    label: string;
    placeholder: string;
    attributes: Record<string, string>;
    fieldType: string;
    options: string[];
    /** True when the page sent more options than the budgets allow. */
    optionsCut: boolean;
}

export interface ClassifyRequest {
    fields: FieldToClassify[];
    jobTitle: string;
    jobDescription: string;
    employerName: string;
}

/** Fields classified per request; the rest of a long form is ignored, as before. */
export const MAX_CLASSIFY_FIELDS = 40;
/** The prompt shows 120 characters of a label; clustering reads this much. */
const MAX_LABEL_CHARS = 1_000;
const MAX_PLACEHOLDER_CHARS = 300;
const MAX_FIELD_TYPE_CHARS = 30;
const MAX_ATTRIBUTE_CHARS = 200;
/** The extension already skips scraped options of 200 characters or more. */
const MAX_OPTION_CHARS = 200;
const MAX_OPTIONS_PER_FIELD = 500;
/** Each option costs its length plus the ' | ' it is joined with. */
const OPTION_SEPARATOR_CHARS = 3;
const MAX_OPTION_CHARS_PER_FIELD = 16_000;
const MAX_OPTION_CHARS_PER_REQUEST = 64_000;

/** The only attributes the prompt reads. */
const PROMPT_ATTRIBUTE_KEYS = ['name', 'id', 'aria-label', 'data-automation-id'] as const;

function pickPromptAttributes(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const picked: Record<string, string> = {};
    for (const key of PROMPT_ATTRIBUTE_KEYS) {
        const text = cleanText(value[key], MAX_ATTRIBUTE_CHARS);
        if (text) picked[key] = text;
    }
    return picked;
}

/** Lowercase letters, digits and hyphens only: the prompt shows the type unquoted. */
function normalizeFieldType(value: unknown): string {
    return cleanText(value, MAX_FIELD_TYPE_CHARS).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** String options in page order, within the per-field budget and what is left of the request budget. */
function normalizeOptions(value: unknown, requestBudgetLeft: number): { options: string[]; cost: number; cut: boolean } {
    if (!Array.isArray(value)) return { options: [], cost: 0, cut: false };
    const budget = Math.min(MAX_OPTION_CHARS_PER_FIELD, requestBudgetLeft);
    const options: string[] = [];
    let cost = 0;
    let cut = value.length > MAX_OPTIONS_PER_FIELD;
    for (const item of value.slice(0, MAX_OPTIONS_PER_FIELD)) {
        if (typeof item !== 'string') continue;
        const option = cleanText(item, MAX_OPTION_CHARS);
        const optionCost = option.length + OPTION_SEPARATOR_CHARS;
        if (cost + optionCost > budget) {
            cut = true;
            break;
        }
        // A shortened option can no longer be matched exactly either.
        if (option.length < item.length) cut = true;
        options.push(option);
        cost += optionCost;
    }
    return { options, cost, cut };
}

/**
 * The typed, bounded request, or null when there is no non-empty `fields`
 * array (the route answers 400). Every field keeps its position, a
 * non-object one as an empty field, so the indices the model returns still
 * line up with what the extension sent.
 */
export function parseClassifyRequest(body: unknown): ClassifyRequest | null {
    if (!isRecord(body) || !Array.isArray(body.fields) || body.fields.length === 0) return null;

    const fields: FieldToClassify[] = [];
    let optionBudgetLeft = MAX_OPTION_CHARS_PER_REQUEST;
    for (const raw of body.fields.slice(0, MAX_CLASSIFY_FIELDS)) {
        const field: Record<string, unknown> = isRecord(raw) ? raw : {};
        const { options, cost, cut } = normalizeOptions(field.options, optionBudgetLeft);
        optionBudgetLeft -= cost;
        fields.push({
            label: cleanText(field.label, MAX_LABEL_CHARS),
            placeholder: cleanText(field.placeholder, MAX_PLACEHOLDER_CHARS),
            attributes: pickPromptAttributes(field.attributes),
            fieldType: normalizeFieldType(field.fieldType),
            options,
            optionsCut: cut,
        });
    }

    return {
        fields,
        jobTitle: cleanText(body.jobTitle, MAX_JOB_TITLE_CHARS),
        jobDescription: cleanText(body.jobDescription, MAX_JOB_DESCRIPTION_CHARS),
        employerName: cleanText(body.employerName, MAX_EMPLOYER_NAME_CHARS),
    };
}

import { sanitizeUrl } from '@/lib/sanitize';
import { createClient } from '@/lib/supabase/server';

/**
 * Input validation shared by the admin job routes
 * (app/api/admin/jobs/route.ts, [id]/route.ts, bulk/route.ts).
 *
 * The routes used to copy allow-listed body keys straight into Prisma, so a
 * wrong type ({ isPublished: 'yes' }, { minSalary: 'abc' }) became a Prisma
 * 500 and a bad value ({ title: '' }, { applyLink: 'javascript:...' }) was
 * persisted and served. Every accepted field now has a declared kind; any
 * value that does not fit its kind rejects the whole request (400) and
 * nothing is written.
 */

type FieldKind =
    | 'requiredText'
    | 'optionalText'
    | 'boolean'
    | 'optionalInt'
    | 'int'
    | 'stringArray'
    | 'applyLink';

const INT32_MAX = 2_147_483_647;
const MAX_TEXT_LENGTH = 500;
const MAX_LONG_TEXT_LENGTH = 100_000;
const MAX_BENEFITS = 50;

const LONG_TEXT_FIELDS = new Set(['description', 'descriptionSummary']);

/** Fields PATCH /api/admin/jobs/:id accepts (expiresAt is validated in the route). */
export const UPDATE_FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
    title: 'requiredText',
    employer: 'requiredText',
    location: 'requiredText',
    description: 'requiredText',
    descriptionSummary: 'optionalText',
    applyLink: 'applyLink',
    jobType: 'optionalText',
    mode: 'optionalText',
    city: 'optionalText',
    state: 'optionalText',
    stateCode: 'optionalText',
    country: 'optionalText',
    isRemote: 'boolean',
    isHybrid: 'boolean',
    salaryRange: 'optionalText',
    minSalary: 'optionalInt',
    maxSalary: 'optionalInt',
    salaryPeriod: 'optionalText',
    displaySalary: 'optionalText',
    normalizedMinSalary: 'optionalInt',
    normalizedMaxSalary: 'optionalInt',
    isPublished: 'boolean',
    isFeatured: 'boolean',
    isVerifiedEmployer: 'boolean',
    benefits: 'stringArray',
    setting: 'optionalText',
    population: 'optionalText',
    qualityScore: 'int',
};

/** Optional fields POST /api/admin/jobs accepts beyond the required five. */
export const CREATE_OPTIONAL_FIELDS = [
    'isPublished', 'isFeatured', 'jobType', 'mode', 'city', 'state',
    'salaryRange', 'minSalary', 'maxSalary', 'salaryPeriod', 'displaySalary',
    'isRemote', 'isHybrid', 'benefits', 'setting', 'population',
] as const;

export const CREATE_REQUIRED_FIELDS = ['title', 'employer', 'location', 'description', 'applyLink'] as const;

export type ValidationResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: string };

type FieldResult = { ok: true; value: unknown } | { ok: false; error: string };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** http(s) only. sanitizeUrl strips javascript:/data:/protocol-relative; the regex drops mailto: and relative paths. */
export function normalizeApplyLink(raw: string): string | null {
    const cleaned = sanitizeUrl(raw);
    if (!cleaned || !/^https?:\/\/[^\s/]+/i.test(cleaned)) return null;
    try {
        const parsed = new URL(cleaned);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? cleaned : null;
    } catch {
        return null;
    }
}

function parseInteger(field: string, value: unknown): FieldResult {
    const n = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)
            ? Number(value)
            : Number.NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > INT32_MAX) {
        return { ok: false, error: `${field} must be a whole number` };
    }
    return { ok: true, value: n };
}

function validateField(field: string, kind: FieldKind, value: unknown): FieldResult {
    const maxLength = LONG_TEXT_FIELDS.has(field) ? MAX_LONG_TEXT_LENGTH : MAX_TEXT_LENGTH;
    switch (kind) {
        case 'requiredText': {
            if (typeof value !== 'string' || value.trim() === '') {
                return { ok: false, error: `${field} must be a non-empty string` };
            }
            if (value.length > maxLength) return { ok: false, error: `${field} is too long` };
            return { ok: true, value: value.trim() };
        }
        case 'optionalText': {
            if (value === null || value === '') return { ok: true, value: null };
            if (typeof value !== 'string') return { ok: false, error: `${field} must be a string or null` };
            if (value.length > maxLength) return { ok: false, error: `${field} is too long` };
            const trimmed = value.trim();
            return { ok: true, value: trimmed === '' ? null : trimmed };
        }
        case 'boolean':
            return typeof value === 'boolean'
                ? { ok: true, value }
                : { ok: false, error: `${field} must be true or false` };
        case 'optionalInt': {
            if (value === null || value === '') return { ok: true, value: null };
            const parsed = parseInteger(field, value);
            if (parsed.ok && (parsed.value as number) < 0) {
                return { ok: false, error: `${field} cannot be negative` };
            }
            return parsed;
        }
        case 'int':
            return parseInteger(field, value);
        case 'stringArray': {
            if (!Array.isArray(value) || value.length > MAX_BENEFITS || !value.every((v) => typeof v === 'string' && v.length <= MAX_TEXT_LENGTH)) {
                return { ok: false, error: `${field} must be a list of strings` };
            }
            return { ok: true, value: value.map((v: string) => v.trim()).filter((v: string) => v !== '') };
        }
        case 'applyLink': {
            if (value === null || value === '') return { ok: true, value: null };
            if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
            const link = normalizeApplyLink(value);
            return link
                ? { ok: true, value: link }
                : { ok: false, error: `${field} must be an http or https URL` };
        }
    }
}

/**
 * Validate a PATCH body. Unknown keys are ignored (as before); every known key
 * must fit its kind. `currentApplyLink` lets an edit that resends the stored
 * link unchanged (e.g. a legacy mailto: link) through, while any NEW link must
 * be http(s).
 */
export function validateJobUpdate(body: unknown, currentApplyLink?: string | null): ValidationResult {
    if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object' };
    const data: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(UPDATE_FIELD_KINDS)) {
        if (!(field in body)) continue;
        const raw = body[field];
        if (field === 'applyLink' && raw != null && raw !== '' && raw === currentApplyLink) {
            continue; // unchanged; nothing to write
        }
        const result = validateField(field, kind, raw);
        if (!result.ok) return result;
        data[field] = result.value;
    }
    return { ok: true, data };
}

/** Validate a POST body: the five required fields plus the optional create allow-list. */
export function validateJobCreate(body: unknown): ValidationResult {
    if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object' };
    const missing = CREATE_REQUIRED_FIELDS.filter((f) => {
        const v = body[f];
        return v == null || (typeof v === 'string' && v.trim() === '');
    });
    if (missing.length > 0) {
        return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
    }
    const data: Record<string, unknown> = {};
    for (const field of [...CREATE_REQUIRED_FIELDS, ...CREATE_OPTIONAL_FIELDS]) {
        if (!(field in body)) continue;
        const result = validateField(field, UPDATE_FIELD_KINDS[field], body[field]);
        if (!result.ok) return result;
        data[field] = result.value;
    }
    return { ok: true, data };
}

/** Swap an inverted salary range so BETWEEN queries do not come back empty. */
export function withOrderedSalary(data: Record<string, unknown>): Record<string, unknown> {
    const min = data.minSalary;
    const max = data.maxSalary;
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
        return { ...data, minSalary: max, maxSalary: min };
    }
    return data;
}

/**
 * Publish-state side effects. An admin unpublish pins the job against ingest
 * renewal (lib/ingestion-service.ts renewJob skips isManuallyUnpublished rows);
 * an admin republish releases the pin.
 */
export function publishStateFields(isPublished: boolean): { isPublished: boolean; isManuallyUnpublished: boolean; unpublishedAt?: Date } {
    return isPublished
        ? { isPublished: true, isManuallyUnpublished: false }
        : { isPublished: false, isManuallyUnpublished: true, unpublishedAt: new Date() };
}

/** Audit action for a PATCH: toggles get their own verb, anything else is an update. */
export function patchAuditAction(fields: string[], data: Record<string, unknown>): string {
    if (fields.length === 1 && fields[0] === 'isPublished') {
        return data.isPublished ? 'admin.job.publish' : 'admin.job.unpublish';
    }
    if (fields.length === 1 && fields[0] === 'isFeatured') {
        return data.isFeatured ? 'admin.job.feature' : 'admin.job.unfeature';
    }
    return 'admin.job.update';
}

/** Parse a positive integer query param, falling back to the default on junk. */
export function parsePagingParam(raw: string | null, fallback: number, max: number): number {
    const n = raw == null ? Number.NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(max, n);
}

/**
 * Supabase id of the admin making the request, for the audit trail.
 * requireApiAdmin returns only pass/fail, so re-read the session rather than
 * trusting anything client supplied (same pattern as the companies route).
 */
export async function resolveAdminActorId(): Promise<string | null> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        return user?.id ?? null;
    } catch {
        return null;
    }
}

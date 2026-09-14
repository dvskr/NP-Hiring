import { sanitizeText } from '@/lib/sanitize';

/**
 * Request-payload validation shared by the messaging routes:
 *   POST  /api/conversations/[id]                              (reply)
 *   PATCH /api/conversations/[id]/messages/[messageId]/edit    (edit)
 *   POST  /api/employer/messages                               (InMail)
 *
 * Every check fails closed: a malformed JSON body, a non-object payload, or a
 * field of the wrong type is a 400, never a TypeError or Prisma 500.
 */

export const MESSAGE_BODY_MAX = 2000;
export const SUBJECT_MAX = 200;
export const ATTACHMENT_NAME_MAX = 255;
/** Supabase uids and Prisma cuids are far shorter; anything longer is junk. */
export const ID_MAX = 128;

export type PayloadResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

type JsonObject = Record<string, unknown>;

/**
 * Parse a request body as a JSON object. Returns null for malformed JSON,
 * an empty body, or any top-level value that is not a plain object.
 */
export async function readJsonObject(req: Request): Promise<JsonObject | null> {
    let parsed: unknown;
    try {
        parsed = await req.json();
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    return parsed as JsonObject;
}

const isOptionalString = (v: unknown): v is string | null | undefined =>
    v === undefined || v === null || typeof v === 'string';

const isId = (v: unknown): v is string =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= ID_MAX;

export interface ReplyPayload {
    body: string;
    attachmentUrl: string | null;
    attachmentName: string | null;
}

export function validateReplyPayload(raw: JsonObject | null): PayloadResult<ReplyPayload> {
    if (!raw) return { ok: false, error: 'Invalid request body' };
    const { body, attachmentUrl, attachmentName } = raw;

    if (!isOptionalString(body)) {
        return { ok: false, error: 'Message body must be text' };
    }
    if (!isOptionalString(attachmentUrl) || !isOptionalString(attachmentName)) {
        return { ok: false, error: 'Invalid attachment' };
    }

    const text = (body ?? '').trim();
    if (!text && !attachmentUrl) {
        return { ok: false, error: 'Message body or attachment is required' };
    }
    if (text.length > MESSAGE_BODY_MAX) {
        return { ok: false, error: `Message must be under ${MESSAGE_BODY_MAX} characters` };
    }

    return {
        ok: true,
        value: {
            body: text,
            attachmentUrl: attachmentUrl || null,
            attachmentName: attachmentName ? attachmentName.slice(0, ATTACHMENT_NAME_MAX) : null,
        },
    };
}

export interface EmployerSendPayload {
    recipientId: string;
    subject: string;
    body: string;
    jobId: string | null;
}

export function validateEmployerSendPayload(raw: JsonObject | null): PayloadResult<EmployerSendPayload> {
    if (!raw) return { ok: false, error: 'Invalid request body' };
    const { recipientId, subject, body, jobId } = raw;

    if (!isId(recipientId) || typeof subject !== 'string' || typeof body !== 'string'
        || !subject.trim() || !body.trim()) {
        return { ok: false, error: 'recipientId, subject, and body are required' };
    }
    if (jobId !== undefined && jobId !== null && !isId(jobId)) {
        return { ok: false, error: 'Invalid jobId' };
    }
    if (subject.trim().length > SUBJECT_MAX) {
        return { ok: false, error: `Subject must be under ${SUBJECT_MAX} characters` };
    }
    if (body.length > MESSAGE_BODY_MAX) {
        return { ok: false, error: `Message body must be under ${MESSAGE_BODY_MAX} characters` };
    }

    // Same sanitizer as the body: the subject is stored on Conversation and
    // EmployerMessage and echoed into notification emails.
    const cleanSubject = sanitizeText(subject.trim(), SUBJECT_MAX);
    if (!cleanSubject) {
        return { ok: false, error: 'recipientId, subject, and body are required' };
    }

    return {
        ok: true,
        value: {
            recipientId,
            subject: cleanSubject,
            body,
            jobId: jobId || null,
        },
    };
}

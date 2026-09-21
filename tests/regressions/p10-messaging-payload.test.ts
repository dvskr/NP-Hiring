/**
 * P10 messaging regressions (API side):
 *   - reply / employer-send / edit routes returned 500 on non-string bodies,
 *     object-valued recipientId / jobId (Prisma operator injection) and
 *     malformed JSON; they must answer 400
 *   - employer InMail subject was stored unsanitized and uncapped
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    readJsonObject,
    validateReplyPayload,
    validateEmployerSendPayload,
    SUBJECT_MAX,
} from '@/app/api/conversations/_lib/message-payload';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const jsonRequest = (raw: string) =>
    new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
    });

describe('readJsonObject', () => {
    it('returns null for malformed JSON instead of throwing', async () => {
        await expect(readJsonObject(jsonRequest('{not json'))).resolves.toBeNull();
    });
    it('returns null for an empty body and for non-object JSON', async () => {
        await expect(readJsonObject(jsonRequest(''))).resolves.toBeNull();
        await expect(readJsonObject(jsonRequest('[1,2]'))).resolves.toBeNull();
        await expect(readJsonObject(jsonRequest('"text"'))).resolves.toBeNull();
        await expect(readJsonObject(jsonRequest('null'))).resolves.toBeNull();
    });
    it('returns the object for a valid payload', async () => {
        await expect(readJsonObject(jsonRequest('{"body":"hi"}'))).resolves.toEqual({ body: 'hi' });
    });
});

describe('validateReplyPayload', () => {
    it.each([123, ['x'], { nested: true }, true])('rejects body=%j', (body) => {
        expect(validateReplyPayload({ body }).ok).toBe(false);
    });
    it('rejects a non-string attachmentName or attachmentUrl', () => {
        expect(validateReplyPayload({ body: 'x', attachmentUrl: 'a.pdf', attachmentName: 5 }).ok).toBe(false);
        expect(validateReplyPayload({ body: 'x', attachmentUrl: { a: 1 } }).ok).toBe(false);
    });
    it('rejects a missing payload, an empty message and an overlong body', () => {
        expect(validateReplyPayload(null).ok).toBe(false);
        expect(validateReplyPayload({ body: '   ' }).ok).toBe(false);
        expect(validateReplyPayload({ body: 'x'.repeat(2001) }).ok).toBe(false);
    });
    it('accepts text, or an attachment alone, trimming and capping the name', () => {
        const text = validateReplyPayload({ body: '  hello  ' });
        expect(text).toEqual({ ok: true, value: { body: 'hello', attachmentUrl: null, attachmentName: null } });
        const file = validateReplyPayload({ attachmentUrl: 'uid/1_cv.pdf', attachmentName: 'n'.repeat(400) });
        expect(file.ok).toBe(true);
        if (file.ok) expect(file.value.attachmentName).toHaveLength(255);
    });
});

describe('validateEmployerSendPayload', () => {
    const base = { recipientId: 'supabase-uid', subject: 'Hello', body: 'Body' };

    it.each([
        { ...base, recipientId: { $ne: '' } },
        { ...base, recipientId: ['x'] },
        { ...base, recipientId: '' },
        { ...base, jobId: { id: 1 } },
        { ...base, jobId: 42 },
        { ...base, subject: 7 },
        { ...base, body: false },
    ])('rejects type-confused payload %j', (payload) => {
        expect(validateEmployerSendPayload(payload).ok).toBe(false);
    });

    it('rejects a 20,000 character subject', () => {
        expect(validateEmployerSendPayload({ ...base, subject: 'x'.repeat(20_000) }).ok).toBe(false);
        expect(validateEmployerSendPayload({ ...base, subject: 'x'.repeat(SUBJECT_MAX + 1) }).ok).toBe(false);
        expect(validateEmployerSendPayload({ ...base, subject: 'x'.repeat(SUBJECT_MAX) }).ok).toBe(true);
    });

    it('sanitizes script tags and event handlers out of the subject', () => {
        const res = validateEmployerSendPayload({
            ...base,
            subject: '<script>alert("s")</script>Subject probe onclick="x()"',
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.value.subject).toBe('Subject probe');
            expect(res.value.subject).not.toMatch(/<script|onclick=/i);
        }
    });

    it('rejects a subject that sanitizes down to nothing', () => {
        expect(validateEmployerSendPayload({ ...base, subject: '<script>alert(1)</script> onclick="x()"' }).ok).toBe(false);
    });

    it('normalizes an absent jobId to null and keeps a string jobId', () => {
        const a = validateEmployerSendPayload(base);
        const b = validateEmployerSendPayload({ ...base, jobId: 'job_1' });
        expect(a.ok && a.value.jobId).toBeNull();
        expect(b.ok && b.value.jobId).toBe('job_1');
    });
});

describe('routes use the shared validators (no raw req.json())', () => {
    it.each([
        'app/api/conversations/[id]/route.ts',
        'app/api/employer/messages/route.ts',
        'app/api/conversations/[id]/messages/[messageId]/edit/route.ts',
    ])('%s parses JSON through readJsonObject', (rel) => {
        const src = read(rel);
        expect(src).toContain('readJsonObject(req)');
        expect(src).not.toMatch(/await req\.json\(\)/);
    });

    it('reply route validates with validateReplyPayload and answers 400', () => {
        expect(read('app/api/conversations/[id]/route.ts')).toMatch(
            /validateReplyPayload\(await readJsonObject\(req\)\)[\s\S]{0,120}status: 400/,
        );
    });

    it('employer send stores the validated (sanitized) subject on both rows', () => {
        const src = read('app/api/employer/messages/route.ts');
        expect(src).toMatch(/validateEmployerSendPayload\(await readJsonObject\(req\)\)[\s\S]{0,120}status: 400/);
        expect(src).toMatch(/= payload\.value;/);
    });
});

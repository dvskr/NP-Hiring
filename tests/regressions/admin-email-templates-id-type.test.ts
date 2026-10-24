/**
 * POST /api/admin/email/templates accepts only a string template id.
 *
 * The route reads an optional id from the JSON body: no id creates a template,
 * an id updates that one with emailTemplate.update({ where: { id } }). A JSON
 * body can carry an object or a number there, which Prisma rejects, so a
 * request with one answered 500 "Failed to save template". The route now
 * answers 400, before any query, when an id is present and is not a plain
 * string (lib/request-body.ts). No id still creates, as before. Admin only.
 *
 * Prisma and the admin gate are mocked: nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const db = vi.hoisted(() => ({ emailTemplate: { update: vi.fn(), create: vi.fn() } }));
const requireApiAdmin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin }));

import { POST } from '@/app/api/admin/email/templates/route';

const TEMPLATE = { name: 'Welcome', subject: 'Hello there', body: '<p>Welcome aboard.</p>' };

function post(body: unknown): Request {
    return new Request('http://localhost:3000/api/admin/email/templates', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

/** Ids a JSON body can carry that are present but are not a plain string. */
const BAD_TEMPLATE_IDS: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'tpl' }],
    ['an array', ['tpl-1']],
    ['a number', 12345],
    ['a boolean', true],
    ['an overlong string', 'a'.repeat(201)],
];

beforeEach(() => {
    vi.clearAllMocks();
    requireApiAdmin.mockResolvedValue(null);
    db.emailTemplate.update.mockResolvedValue({ id: 'tpl-1', ...TEMPLATE });
    db.emailTemplate.create.mockResolvedValue({ id: 'tpl-2', ...TEMPLATE });
});

describe('POST /api/admin/email/templates', () => {
    it.each(BAD_TEMPLATE_IDS)('refuses %s as the template id with 400 and writes nothing', async (_label, id) => {
        const res = await POST(post({ id, ...TEMPLATE }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ success: false, error: 'Template ID must be a string' });
        expect(db.emailTemplate.update).not.toHaveBeenCalled();
        expect(db.emailTemplate.create).not.toHaveBeenCalled();
    });

    it('still updates by equality on a string id', async () => {
        const res = await POST(post({ id: 'tpl-1', ...TEMPLATE }));

        expect(res.status).toBe(200);
        expect(db.emailTemplate.update).toHaveBeenCalledWith({ where: { id: 'tpl-1' }, data: TEMPLATE });
        expect(db.emailTemplate.create).not.toHaveBeenCalled();
    });

    it.each([
        ['no id', undefined],
        ['a null id', null],
    ])('still creates a template when the body has %s', async (_label, id) => {
        const res = await POST(post({ id, ...TEMPLATE }));

        expect(res.status).toBe(200);
        expect(db.emailTemplate.create).toHaveBeenCalledWith({ data: TEMPLATE });
        expect(db.emailTemplate.update).not.toHaveBeenCalled();
    });

    it('still requires a name, a subject and a body', async () => {
        const res = await POST(post({ id: 'tpl-1', name: 'Welcome', subject: 'Hello there' }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ success: false, error: 'name, subject, and body are required' });
        expect(db.emailTemplate.update).not.toHaveBeenCalled();
    });

    it('the admin gate runs first: a non-admin gets its answer and nothing is written', async () => {
        requireApiAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));

        const res = await POST(post({ id: { not: '' }, ...TEMPLATE }));

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Admin access required' });
        expect(db.emailTemplate.update).not.toHaveBeenCalled();
        expect(db.emailTemplate.create).not.toHaveBeenCalled();
    });
});

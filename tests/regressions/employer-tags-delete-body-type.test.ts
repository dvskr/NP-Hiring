/**
 * DELETE /api/employer/tags accepts only a string tag id (Prisma operator injection).
 *
 * The route read tagId from the JSON body and ran
 * candidateTag.deleteMany({ where: { id: tagId, employerId } }). deleteMany
 * takes a non-unique where clause, and Prisma reads an object there as a
 * filter, not an equality: { "not": "" } matched every tag the caller owns, so
 * one request deleted all of them. The route now answers 400, before any
 * query, when the tag id is not a plain string (lib/request-body.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const h = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));

import { DELETE } from '@/app/api/employer/tags/route';

function del(body: string): NextRequest {
    return new NextRequest('http://localhost:3000/api/employer/tags', {
        method: 'DELETE',
        body,
        headers: { 'content-type': 'application/json' },
    });
}

const BAD_TAG_IDS: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'tag' }],
    ['an in filter', { in: ['tag-1', 'tag-2'] }],
    ['an array', ['tag-1']],
    ['a number', 12345],
    ['a boolean', true],
    ['null', null],
    ['no value', undefined],
    ['an empty string', ''],
    ['an overlong string', 'a'.repeat(201)],
];

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: 'auth-employer' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-employer', role: 'employer' } as never);
    vi.mocked(prisma.candidateTag.deleteMany).mockResolvedValue({ count: 1 });
});

describe('DELETE /api/employer/tags', () => {
    it.each(BAD_TAG_IDS)('refuses %s as the tag id with 400 and deletes nothing', async (_label, tagId) => {
        const res = await DELETE(del(JSON.stringify({ tagId })));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'tagId is required' });
        expect(prisma.candidateTag.deleteMany).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"tagId":'],
        ['an empty body', ''],
        ['a null body', 'null'],
        ['an array body', JSON.stringify([{ tagId: 'tag-1' }])],
        ['a string body', '"tag-1"'],
    ])('refuses %s with 400 and deletes nothing', async (_label, body) => {
        const res = await DELETE(del(body));
        expect(res.status).toBe(400);
        expect(prisma.candidateTag.deleteMany).not.toHaveBeenCalled();
    });

    it('still deletes by equality on the tag id and the caller profile', async () => {
        const res = await DELETE(del(JSON.stringify({ tagId: 'tag-1' })));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(prisma.candidateTag.deleteMany).toHaveBeenCalledWith({
            where: { id: 'tag-1', employerId: 'profile-employer' },
        });
    });

    it('still answers 401 without a session, before reading the body or the database', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const res = await DELETE(del(JSON.stringify({ tagId: 'tag-1' })));
        expect(res.status).toBe(401);
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.candidateTag.deleteMany).not.toHaveBeenCalled();
    });

    it('still answers 403 for a job seeker', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-seeker', role: 'job_seeker' } as never);
        const res = await DELETE(del(JSON.stringify({ tagId: 'tag-1' })));
        expect(res.status).toBe(403);
        expect(prisma.candidateTag.deleteMany).not.toHaveBeenCalled();
    });
});

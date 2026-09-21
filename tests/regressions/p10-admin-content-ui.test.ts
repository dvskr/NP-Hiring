/**
 * P10 admin-content-ui regressions:
 *  1. /admin/jobs reports non-2xx PATCH/DELETE/bulk responses instead of swallowing them
 *  2. the Edit Job modal is a real dialog (role, aria-modal, label, focus trap, Escape)
 *  3. admin blog create/update/delete write AuditLog rows; PUT validates status and
 *     title; unknown ids are 404
 *  4. featuring, unfeaturing and narrowing a testimonial write AuditLog rows
 *  5. AI flag overrides record setBy and write an AuditLog row
 *  6. PATCH /api/admin/pd-campaign maps P2025 to a generic 404
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { admin: { limit: 20, windowMs: 60_000 } },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: vi.fn() },
        blogPost: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        employerTestimonial: { findUnique: vi.fn(), update: vi.fn() },
        aiFeatureFlagOverride: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
        programDirectorLead: { update: vi.fn() },
    },
}));

const logAuditMock = vi.fn();
vi.mock('@/lib/audit-log', () => ({
    logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock('@/lib/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/protect', () => ({
    requireAdmin: vi.fn(async () => ({ user: { id: 'admin-supabase-id' }, profile: { role: 'admin' } })),
}));

import { prisma } from '@/lib/prisma';
import { POST as blogPOST } from '@/app/api/admin/blog/route';
import { PUT as blogPUT, DELETE as blogDELETE } from '@/app/api/admin/blog/[id]/route';
import { PATCH as testimonialPATCH } from '@/app/api/admin/testimonials/[id]/route';
import { POST as flagsPOST } from '@/app/api/admin/ai/flags/route';
import { PATCH as pdPATCH } from '@/app/api/admin/pd-campaign/route';
import { parseBlogStatus, parseBlogTitle, isRecordNotFound } from '@/app/api/admin/blog/validate';
import { readApiError } from '@/app/admin/jobs/api-feedback';

const ADMIN = 'admin-supabase-id';
const POST_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;
const p2025 = () => Object.assign(new Error('Record to update not found. clientVersion 6'), { code: 'P2025' });

function req(url: string, method: string, body?: unknown): NextRequest {
    return new NextRequest(`https://example.com${url}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: ADMIN } }, error: null });
    m(prisma.userProfile.findUnique).mockResolvedValue({ role: 'admin' });
});

describe('admin blog validation helpers', () => {
    it('accepts only draft and published', () => {
        expect(parseBlogStatus('draft')).toEqual({ ok: true, value: 'draft' });
        expect(parseBlogStatus('published')).toEqual({ ok: true, value: 'published' });
        expect(parseBlogStatus('bogus').ok).toBe(false);
        expect(parseBlogStatus(1).ok).toBe(false);
    });
    it('refuses blank or non-string titles and trims good ones', () => {
        expect(parseBlogTitle('').ok).toBe(false);
        expect(parseBlogTitle('   ').ok).toBe(false);
        expect(parseBlogTitle(42).ok).toBe(false);
        expect(parseBlogTitle('  Hello  ')).toEqual({ ok: true, value: 'Hello' });
    });
    it('recognises P2025 only', () => {
        expect(isRecordNotFound(p2025())).toBe(true);
        expect(isRecordNotFound(new Error('boom'))).toBe(false);
        expect(isRecordNotFound(null)).toBe(false);
    });
});

describe('admin blog routes', () => {
    it('POST writes an AuditLog row attributed to the admin', async () => {
        m(prisma.blogPost.create).mockResolvedValue({ id: POST_ID, slug: 's', status: 'draft', category: 'c' });
        const res = await blogPOST(req('/api/admin/blog', 'POST', { title: 'T', content: 'C', category: 'job_seeker_attraction' }));
        expect(res.status).toBe(201);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'blog.post.create', actorType: 'admin', actorId: ADMIN, targetId: POST_ID,
        }));
    });

    it('POST refuses an unknown status', async () => {
        const res = await blogPOST(req('/api/admin/blog', 'POST', { title: 'T', content: 'C', category: 'x', status: 'bogus' }));
        expect(res.status).toBe(400);
        expect(prisma.blogPost.create).not.toHaveBeenCalled();
    });

    it('PUT refuses status bogus and an empty title without writing', async () => {
        const bad = await blogPUT(req(`/api/admin/blog/${POST_ID}`, 'PUT', { status: 'bogus' }), ctx(POST_ID));
        expect(bad.status).toBe(400);
        const empty = await blogPUT(req(`/api/admin/blog/${POST_ID}`, 'PUT', { title: '' }), ctx(POST_ID));
        expect(empty.status).toBe(400);
        expect(prisma.blogPost.update).not.toHaveBeenCalled();
        expect(logAuditMock).not.toHaveBeenCalled();
    });

    it('PUT on an unknown id is 404 and an empty body is 400', async () => {
        m(prisma.blogPost.findUnique).mockResolvedValue(null);
        const missing = await blogPUT(req(`/api/admin/blog/${UNKNOWN}`, 'PUT', { title: 'x' }), ctx(UNKNOWN));
        expect(missing.status).toBe(404);
        const nothing = await blogPUT(req(`/api/admin/blog/${UNKNOWN}`, 'PUT', {}), ctx(UNKNOWN));
        expect(nothing.status).toBe(400);
        expect(prisma.blogPost.update).not.toHaveBeenCalled();
    });

    it('PUT maps a P2025 race to 404', async () => {
        m(prisma.blogPost.findUnique).mockResolvedValue({ status: 'draft', publishDate: null });
        m(prisma.blogPost.update).mockRejectedValue(p2025());
        const res = await blogPUT(req(`/api/admin/blog/${POST_ID}`, 'PUT', { title: 'x' }), ctx(POST_ID));
        expect(res.status).toBe(404);
    });

    it('PUT publishing stamps publishDate once and audits the publish', async () => {
        m(prisma.blogPost.findUnique).mockResolvedValue({ status: 'draft', publishDate: null });
        m(prisma.blogPost.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: POST_ID, slug: 's', ...data }));
        const res = await blogPUT(req(`/api/admin/blog/${POST_ID}`, 'PUT', { status: 'published' }), ctx(POST_ID));
        expect(res.status).toBe(200);
        const data = m(prisma.blogPost.update).mock.calls[0][0].data;
        expect(data.publishDate).toBeInstanceOf(Date);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'blog.post.publish', actorId: ADMIN, targetId: POST_ID }));
    });

    it('DELETE audits and maps an unknown id to 404', async () => {
        m(prisma.blogPost.delete).mockResolvedValueOnce({ id: POST_ID, slug: 's', status: 'draft' });
        const ok = await blogDELETE(req(`/api/admin/blog/${POST_ID}`, 'DELETE'), ctx(POST_ID));
        expect(ok.status).toBe(200);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'blog.post.delete', targetId: POST_ID }));

        m(prisma.blogPost.delete).mockRejectedValueOnce(p2025());
        const missing = await blogDELETE(req(`/api/admin/blog/${UNKNOWN}`, 'DELETE'), ctx(UNKNOWN));
        expect(missing.status).toBe(404);
    });

    it('fails closed when the acting admin cannot be resolved', async () => {
        m(prisma.blogPost.findUnique).mockResolvedValue({ status: 'draft', publishDate: null });
        getUserMock
            .mockResolvedValueOnce({ data: { user: { id: ADMIN } }, error: null }) // requireApiAdmin
            .mockResolvedValueOnce({ data: { user: null }, error: null }); // actor lookup
        const res = await blogPUT(req(`/api/admin/blog/${POST_ID}`, 'PUT', { title: 'x' }), ctx(POST_ID));
        expect(res.status).toBe(401);
        expect(prisma.blogPost.update).not.toHaveBeenCalled();
    });
});

describe('admin testimonial review audit', () => {
    const base = { id: 't1', userId: 'u', employerJobId: null, employerName: 'E', content: 'c', rating: 5, consent: true, createdAt: new Date() };

    it.each([
        [{ featured: true }, { ...base, displayAs: 'initial', featuredAt: null }, 'testimonial.feature'],
        [{ featured: false }, { ...base, displayAs: 'initial', featuredAt: new Date() }, 'testimonial.unfeature'],
        [{ displayAs: 'anonymous' }, { ...base, displayAs: 'initial', featuredAt: null }, 'testimonial.display_as.narrow'],
    ])('%j writes an AuditLog row', async (body, existing, action) => {
        m(prisma.employerTestimonial.findUnique).mockResolvedValue(existing);
        m(prisma.employerTestimonial.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
        const res = await testimonialPATCH(req('/api/admin/testimonials/t1', 'PATCH', body), ctx('t1'));
        expect(res.status).toBe(200);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action, actorType: 'admin', actorId: ADMIN, targetId: 't1' }));
    });

    it('a no-op re-feature writes nothing', async () => {
        m(prisma.employerTestimonial.findUnique).mockResolvedValue({ ...base, displayAs: 'initial', featuredAt: new Date() });
        const res = await testimonialPATCH(req('/api/admin/testimonials/t1', 'PATCH', { featured: true }), ctx('t1'));
        expect(res.status).toBe(200);
        expect(prisma.employerTestimonial.update).not.toHaveBeenCalled();
        expect(logAuditMock).not.toHaveBeenCalled();
    });
});

describe('AI flag override attribution', () => {
    it('writes setBy from the session and an AuditLog row', async () => {
        m(prisma.aiFeatureFlagOverride.deleteMany).mockResolvedValue({ count: 1 });
        m(prisma.aiFeatureFlagOverride.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ov1', ...data }));
        const res = await flagsPOST(req('/api/admin/ai/flags', 'POST', {
            flag: 'ai.platform.support_bot', tenantType: 'admin', tenantId: ADMIN, enabled: false,
            // A client-supplied setBy must never be trusted.
            setBy: 'someone-else',
        }));
        expect(res.status).toBe(200);
        expect(m(prisma.aiFeatureFlagOverride.create).mock.calls[0][0].data.setBy).toBe(ADMIN);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai.flag_override.set', actorId: ADMIN, targetId: 'ov1' }));
    });

    it('refuses the flip when the actor cannot be resolved', async () => {
        getUserMock
            .mockResolvedValueOnce({ data: { user: { id: ADMIN } }, error: null })
            .mockRejectedValueOnce(new Error('supabase down'));
        const res = await flagsPOST(req('/api/admin/ai/flags', 'POST', {
            flag: 'ai.platform.support_bot', tenantType: 'global', tenantId: null, enabled: false,
        }));
        expect(res.status).toBe(401);
        expect(prisma.aiFeatureFlagOverride.create).not.toHaveBeenCalled();
    });
});

describe('pd-campaign unknown lead', () => {
    it('maps P2025 to a generic 404 without Prisma internals', async () => {
        m(prisma.programDirectorLead.update).mockRejectedValue(p2025());
        const res = await pdPATCH(new Request('https://example.com/api/admin/pd-campaign', {
            method: 'PATCH', body: JSON.stringify({ id: UNKNOWN, status: 'replied' }),
        }));
        expect(res.status).toBe(404);
        expect(await res.text()).not.toMatch(/prisma|invocation|P2025|clientVersion/i);
    });

    it('other failures are a generic 500', async () => {
        m(prisma.programDirectorLead.update).mockRejectedValue(new Error('Invalid `prisma.programDirectorLead.update()` invocation'));
        const res = await pdPATCH(new Request('https://example.com/api/admin/pd-campaign', {
            method: 'PATCH', body: JSON.stringify({ id: UNKNOWN, status: 'replied' }),
        }));
        expect(res.status).toBe(500);
        expect(await res.text()).not.toMatch(/prisma|invocation/i);
    });
});

describe('/admin/jobs failure feedback', () => {
    const response = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

    it('surfaces the API error for a non-2xx response', async () => {
        expect(await readApiError(response(400, JSON.stringify({ error: 'title must not be empty' })), 'Failed to update job'))
            .toBe('Failed to update job: title must not be empty');
        expect(await readApiError(response(500, JSON.stringify({ success: false, error: 'Failed to update job' })), 'Failed to update job'))
            .toBe('Failed to update job (HTTP 500)');
        expect(await readApiError(response(502, '<html>bad gateway</html>'), 'Bulk action failed'))
            .toBe('Bulk action failed (HTTP 502)');
    });

    const page = readFileSync(path.join(process.cwd(), 'app/admin/jobs/page.tsx'), 'utf8');

    it('every PATCH/DELETE/bulk handler branches on !res.ok', () => {
        expect(page.match(/if \(!res\.ok\) \{/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
        // No success-only branch left that silently ignores failures.
        expect(page).not.toMatch(/if \(res\.ok\) \{/);
        expect(page).not.toMatch(/if \(data\.success\) \{\s*showMsg/);
    });

    it('the Edit Job modal has dialog semantics wired to the shared focus trap', () => {
        expect(page).toContain("import { useFocusTrap } from '@/lib/hooks/useFocusTrap'");
        expect(page).toContain('role="dialog"');
        expect(page).toContain('aria-modal="true"');
        expect(page).toContain('aria-labelledby="edit-job-dialog-title"');
        expect(page).toContain('id="edit-job-dialog-title"');
        expect(page).toMatch(/useFocusTrap<HTMLDivElement>\(\{ isOpen: editingJob !== null, onEscape: closeEdit \}\)/);
        expect(page).toContain('ref={editDialogRef}');
    });
});

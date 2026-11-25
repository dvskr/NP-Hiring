/**
 * Two defects on /admin/blog, and the category rule behind the second.
 *
 *  1. The Preview control was a plain anchor to /blog/<slug>, and the public
 *     loader reads only published posts. Previewing a draft was a guaranteed
 *     404: the only way to see a post before publishing was to publish it.
 *
 *  2. The create API stored any category string, so a new post could land in
 *     a category the blog cannot label or filter on, while the editor showed
 *     a legacy post's category as the first option in its select even though
 *     the form still held the legacy value. A new post now needs a taxonomy
 *     category; an edit keeps a legacy one so old posts stay editable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    requireApiAdmin: vi.fn(),
    resolveAdminActorId: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    logAudit: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: h.requireApiAdmin,
    requireApiAdminActor: vi.fn(async () => ({
        error: null,
        actor: { profileId: 'admin-profile-id', supabaseId: 'admin-supabase-id' },
    })),
}));
vi.mock('@/app/api/admin/blog/admin-actor', () => ({ resolveAdminActorId: h.resolveAdminActorId }));
vi.mock('@/lib/prisma', () => ({
    prisma: { blogPost: { create: h.create, findUnique: h.findUnique, update: h.update } },
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: h.logAudit }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { POST } from '@/app/api/admin/blog/route';
import { PUT } from '@/app/api/admin/blog/[id]/route';
import { parseBlogCategory } from '@/app/api/admin/blog/validate';
import { BLOG_CATEGORIES, blogCategoryLabel, isBlogCategory } from '@/lib/blog-categories';
import { readCode } from '../helpers/source';

const POST_ID = '00000000-0000-4000-8000-000000000001';
const PREVIEW_PAGE = path.join(process.cwd(), 'app/admin/blog/preview/[id]/page.tsx');

function req(method: 'POST' | 'PUT', body: unknown): NextRequest {
    const url = method === 'POST' ? '/api/admin/blog' : `/api/admin/blog/${POST_ID}`;
    return new NextRequest(`https://example.test${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}
const ctx = { params: Promise.resolve({ id: POST_ID }) };

beforeEach(() => {
    vi.clearAllMocks();
    h.requireApiAdmin.mockResolvedValue(null);
    h.resolveAdminActorId.mockResolvedValue('admin-supabase-id');
});

describe('blog category taxonomy', () => {
    it('has a label for every category, so no surface renders a raw id', () => {
        for (const category of BLOG_CATEGORIES) {
            const label = blogCategoryLabel(category.id);
            expect(label).not.toBe(category.id);
            expect(label.trim()).not.toBe('');
        }
    });

    it('falls back to the id for a row that predates the taxonomy', () => {
        expect(blogCategoryLabel('some_legacy_value')).toBe('some_legacy_value');
        expect(isBlogCategory('some_legacy_value')).toBe(false);
        expect(isBlogCategory(BLOG_CATEGORIES[0].id)).toBe(true);
        expect(isBlogCategory(42)).toBe(false);
    });
});

describe('parseBlogCategory', () => {
    it('accepts only taxonomy categories on create', () => {
        for (const { id } of BLOG_CATEGORIES) {
            expect(parseBlogCategory(id, 'create')).toEqual({ ok: true, value: id });
        }
        const refused = parseBlogCategory('some_legacy_value', 'create');
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error).toContain(`'${BLOG_CATEGORIES[0].id}'`);
    });

    it('keeps a legacy category on edit, so old posts stay editable', () => {
        expect(parseBlogCategory('some_legacy_value', 'edit')).toEqual({ ok: true, value: 'some_legacy_value' });
    });

    it('refuses anything that is not non-blank text, in either mode', () => {
        for (const mode of ['create', 'edit'] as const) {
            for (const bad of [undefined, null, '', '   ', 7, { not: '' }, ['state_spotlight']]) {
                expect(parseBlogCategory(bad, mode).ok, `${mode} ${JSON.stringify(bad)}`).toBe(false);
            }
        }
    });
});

describe('admin blog API category rule', () => {
    it('POST refuses a category outside the taxonomy before writing anything', async () => {
        const res = await POST(req('POST', { title: 'T', content: 'C', category: 'some_legacy_value' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/^category must be one of /);
        expect(h.create).not.toHaveBeenCalled();
    });

    it('POST stores a taxonomy category', async () => {
        h.create.mockResolvedValue({ id: POST_ID, slug: 's', status: 'draft', category: 'state_spotlight' });
        const res = await POST(req('POST', { title: 'T', content: 'C', category: 'state_spotlight' }));
        expect(res.status).toBe(201);
        expect(h.create.mock.calls[0][0].data.category).toBe('state_spotlight');
    });

    it('PUT keeps a legacy category the editor sends back unchanged', async () => {
        h.findUnique.mockResolvedValue({ status: 'draft', publishDate: null });
        h.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: POST_ID, slug: 's', status: 'draft', ...data }));
        const res = await PUT(req('PUT', { category: 'some_legacy_value' }), ctx);
        expect(res.status).toBe(200);
        expect(h.update.mock.calls[0][0].data.category).toBe('some_legacy_value');
    });

    it('PUT refuses a category that is not text, instead of handing an object to Prisma', async () => {
        const res = await PUT(req('PUT', { category: { not: '' } }), ctx);
        expect(res.status).toBe(400);
        expect(h.update).not.toHaveBeenCalled();
    });
});

describe('the editor keeps a legacy category', () => {
    it('offers the post own category when it is not in the list, ahead of the list', () => {
        const src = readCode('app/admin/blog/page.tsx');
        const select = src.slice(src.indexOf('<select value={form.category}'));
        const legacyOption = select.indexOf('<option value={form.category}>');
        expect(legacyOption, 'no option for a category outside the list').toBeGreaterThan(-1);
        expect(select.slice(0, legacyOption)).toMatch(/!CATEGORIES\.some\(\s*c\s*=>\s*c\.value\s*===\s*form\.category\s*\)/);
        expect(legacyOption).toBeLessThan(select.indexOf('CATEGORIES.map('));
    });
});

describe('draft preview', () => {
    const src = readCode('app/admin/blog/page.tsx');

    it('does not send a draft to the public URL, which 404s until it is published', () => {
        // The old href was unconditional. The invariant is that the public
        // path is only ever reached from a published check, so require the
        // two to sit in one expression rather than on one physical line:
        // splitting the ternary across lines is a reformat, not a defect.
        const publicHref = src.indexOf('`/blog/${post.slug}`');
        expect(publicHref, 'the public blog href is gone entirely').toBeGreaterThan(-1);
        const attrStart = src.lastIndexOf('href={', publicHref);
        expect(attrStart, 'the public href is not inside an href attribute').toBeGreaterThan(-1);
        const expression = src.slice(attrStart, publicHref);
        expect(
            /post\.status\s*===\s*'published'/.test(expression),
            'the public href is not gated on the post being published',
        ).toBe(true);
    });

    it('points a draft at an admin preview route that exists', () => {
        expect(src).toContain('/admin/blog/preview/${post.id}');
        expect(fs.existsSync(PREVIEW_PAGE)).toBe(true);
    });

    it('renders the preview regardless of status, behind the admin guard, out of the index', () => {
        const preview = readCode('app/admin/blog/preview/[id]/page.tsx');
        // Looking the post up by id rather than by published slug is the whole
        // point; a status filter here would reintroduce the 404.
        expect(preview).toMatch(/prisma\.blogPost\.find(Unique|UniqueOrThrow|First)\b/);
        expect(preview).toMatch(/where:\s*\{\s*id\s*\}/);
        expect(preview).not.toContain("status: 'published'");
        expect(preview).toMatch(/index:\s*false/);
        expect(preview).toContain('await requireAdmin(');
        // The same body pipeline as the public post page.
        for (const step of ['markdownToHtml(', 'autoLinkStates(', 'autoLinkCategories(', 'unlinkClosedLandings(', 'resanitizeBlogHtml(']) {
            expect(preview, step).toContain(step);
        }
    });
});

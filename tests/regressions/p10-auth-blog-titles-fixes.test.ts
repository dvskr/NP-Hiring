/**
 * P10 auth-blog-titles: three defects that survived re-verification round 1.
 *
 * 1. First-login profile bootstrap race. requireAuth (page layout) and
 *    GET /api/auth/profile both call ensureProfileFromAuth on a fresh account;
 *    each saw no row and each created one, so the loser hit the unique
 *    constraint (P2002) and the route answered 500. The loser now re-reads
 *    the winner's row and skips the signup opt-in completion.
 *
 * 2. /blog said "No posts found" while the license guides were live. The dev
 *    database denies the anon role SELECT on blog_posts (42501), and
 *    getPublishedPosts / getPostCount / getAllPublishedSlugs returned empty
 *    on that error BEFORE merging the code-served guides, while getPostBySlug
 *    still rendered every guide. They now fail open for the fallbacks.
 *
 * 3. /my-applications and /settings titles hardcoded the " | brand" suffix
 *    that the root title.template already appends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PERMISSION_DENIED = { code: '42501', message: 'permission denied for table blog_posts' };

/** Every blog_posts query fails the way the dev database does for anon. */
function deniedQuery() {
    const result = { data: null, count: null, error: PERMISSION_DENIED };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'range', 'limit', 'eq', 'neq', 'in', 'like']) q[m] = () => q;
    q.single = async () => result;
    q.maybeSingle = async () => result;
    q.then = (resolve: (v: unknown) => void) => resolve(result);
    return q;
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => deniedQuery() }),
}));

import { ensureProfileFromAuth, isUniqueViolation } from '@/lib/auth/ensure-profile';
import { getPublishedPosts, getPostCount, getAllPublishedSlugs, getPostBySlug } from '@/lib/blog';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const EMAIL = 'fresh-employer@example.invalid';
const user = { id: 'auth-1', email: EMAIL, user_metadata: { role: 'employer', company: 'Acme' } } as unknown as User;

function makePrisma() {
    const rows: Array<Record<string, unknown>> = [];
    const fake = {
        userProfile: {
            findUnique: vi.fn(async ({ where }: { where: { supabaseId: string } }) =>
                rows.find((r) => r.supabaseId === where.supabaseId) ?? null),
            findFirst: vi.fn(async ({ where }: { where: { email: string } }) =>
                rows.find((r) => r.email === where.email) ?? null),
            create: vi.fn(),
            update: vi.fn(),
        },
        employerLead: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'lead' })) },
        emailLead: { upsert: vi.fn() },
        jobAlert: { findFirst: vi.fn(), create: vi.fn() },
    };
    return { fake, rows, prisma: fake as unknown as PrismaClient };
}

describe('ensureProfileFromAuth concurrent first login', () => {
    beforeEach(() => vi.clearAllMocks());

    it('two concurrent bootstraps both resolve to the one created profile', async () => {
        const { fake, rows, prisma } = makePrisma();
        // Both callers pass the lookups before either insert lands; the second
        // insert then violates the unique constraint, as Postgres does.
        let pendingCreates = 0;
        fake.userProfile.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            pendingCreates += 1;
            await new Promise((r) => setTimeout(r, 5));
            if (rows.some((r) => r.supabaseId === data.supabaseId || r.email === data.email)) {
                throw Object.assign(new Error('Unique constraint failed on the fields: (`supabase_id`)'), { code: 'P2002' });
            }
            const row = { id: 'profile-1', ...data };
            rows.push(row);
            return row;
        });

        const [a, b] = await Promise.all([
            ensureProfileFromAuth(prisma, user, { logSource: 'requireAuth' }),
            ensureProfileFromAuth(prisma, user, { logSource: 'GET /api/auth/profile' }),
        ]);

        expect(pendingCreates).toBe(2);
        expect(a?.id).toBe('profile-1');
        expect(b?.id).toBe('profile-1');
        expect(rows).toHaveLength(1);
        // Only the winner completes the signup opt-ins.
        expect(fake.employerLead.create).toHaveBeenCalledTimes(1);
    });

    it('a non unique-constraint create error still propagates (no silent success)', async () => {
        const { fake, prisma } = makePrisma();
        fake.userProfile.create.mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' }));
        await expect(ensureProfileFromAuth(prisma, user)).rejects.toThrow('db down');
    });

    it('a P2002 with no row to re-read rethrows the original error', async () => {
        const { fake, prisma } = makePrisma();
        fake.userProfile.create.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2002' }));
        await expect(ensureProfileFromAuth(prisma, user)).rejects.toThrow('conflict');
    });

    it('isUniqueViolation only matches P2002', () => {
        expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
        expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
        expect(isUniqueViolation(null)).toBe(false);
        expect(isUniqueViolation(new Error('x'))).toBe(false);
    });
});

describe('blog listing fails open for code-served guides when blog_posts is unreadable', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('/blog?category=state_spotlight lists the license guides and counts them', async () => {
        const posts = await getPublishedPosts(1, 12, 'state_spotlight');
        expect(posts.length).toBeGreaterThan(0);
        expect(posts.every((p) => p.slug.startsWith('np-license-'))).toBe(true);
        const count = await getPostCount('state_spotlight');
        expect(count).toBeGreaterThanOrEqual(51);
        const all: string[] = [];
        for (let page = 1; page <= Math.ceil(count / 12); page++) {
            all.push(...(await getPublishedPosts(page, 12, 'state_spotlight')).map((p) => p.slug));
        }
        expect(all).toContain('np-license-texas');
        expect(all).toHaveLength(count);
    });

    it('the unfiltered index, count and sitemap agree with what getPostBySlug renders', async () => {
        const count = await getPostCount();
        expect(count).toBeGreaterThan(0);
        expect((await getPublishedPosts(1, 12)).length).toBe(Math.min(12, count));
        const sitemap = (await getAllPublishedSlugs()).map((r) => r.slug);
        expect(sitemap).toHaveLength(count);
        expect(await getPostBySlug('np-license-texas')).not.toBeNull();
    });
});

describe('auth surface titles carry the brand suffix once', () => {
    it('route layouts leave the suffix to the root title.template', () => {
        expect(read('app/layout.tsx')).toMatch(/template:\s*`%s \| \$\{brand\.name\}`/);
        for (const file of ['app/my-applications/layout.tsx', 'app/settings/layout.tsx']) {
            const title = read(file).match(/^\s*title:\s*(.+),\s*$/m)?.[1] ?? '';
            expect(title, file).not.toMatch(/brand\.name|\|/);
        }
    });
});

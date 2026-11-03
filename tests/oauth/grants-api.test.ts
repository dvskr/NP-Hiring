/**
 * GET and DELETE /api/oauth/grants (design 2.10): the candidate's connected
 * apps in Settings.
 *
 * Pinned: GET lists only the caller's active grants, newest first, at most
 * 50, as { id, clientName, host, scopes, createdAt, lastUsedAt } and nothing
 * else; DELETE revokes only the caller's own active grant (user_revoke) and
 * its refresh tokens, answers 404 for another user's grant exactly as for a
 * missing one, and reads the grant id as a plain short string. Also the
 * Settings card's copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    rateLimit: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit, RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 } } }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import { GET, DELETE, dynamic } from '@/app/api/oauth/grants/route';
import { addGrant, addRefreshToken, db, fakePrisma, resetDb } from './support/fake-prisma';
import { dashesIn, jsonRequest } from './support/fixtures';

const URL_GRANTS = 'https://nphiring.com/api/oauth/grants';
const ME = 'user-1';

async function list(): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await GET(new NextRequest(URL_GRANTS));
    return { status: res.status, json: await res.json() };
}

async function remove(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await DELETE(jsonRequest(URL_GRANTS, body, { Origin: 'https://nphiring.com' }, 'DELETE'));
    return { status: res.status, json: await res.json() };
}

function at(minutesAgo: number): Date {
    return new Date(Date.now() - minutesAgo * 60_000);
}

beforeEach(() => {
    resetDb();
    h.getUser.mockReset().mockResolvedValue({ data: { user: { id: ME, email: 'np@example.com' } }, error: null });
    h.rateLimit.mockReset().mockResolvedValue(null);
});

describe('GET', () => {
    it("lists only the caller's active grants, newest first, with only the listed fields", async () => {
        addGrant({ id: 'g-old', userId: ME, clientName: 'Claude', createdAt: at(60), lastUsedAt: at(5) });
        addGrant({ id: 'g-new', userId: ME, clientName: 'ChatGPT', clientId: 'dcr_x', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect', scopes: ['profile:read'], createdAt: at(1) });
        addGrant({ id: 'g-loopback', userId: ME, clientName: 'Local tool', redirectUri: 'http://127.0.0.1:5000/cb', createdAt: at(30) });
        addGrant({ id: 'g-revoked', userId: ME, createdAt: at(2), revokedAt: at(1), revokedReason: 'user_revoke' });
        addGrant({ id: 'g-theirs', userId: 'user-2', createdAt: at(0) });

        const { status, json } = await list();
        expect(status).toBe(200);
        const grants = json.grants as Array<Record<string, unknown>>;
        expect(grants.map((grant) => grant.id)).toEqual(['g-new', 'g-loopback', 'g-old']);
        for (const grant of grants) {
            expect(Object.keys(grant).sort()).toEqual(['clientName', 'createdAt', 'host', 'id', 'lastUsedAt', 'scopes']);
        }
        expect(grants[0]).toMatchObject({ clientName: 'ChatGPT', host: 'chatgpt.com', scopes: ['profile:read'], lastUsedAt: null });
        expect(grants[1]).toMatchObject({ host: 'this computer' });
        expect(grants[2]).toMatchObject({ clientName: 'Claude', host: 'claude.ai', lastUsedAt: expect.any(String) });
        expect(JSON.stringify(json)).not.toContain('user-2');
    });

    it('queries the caller only, active only, newest first, at most 50', async () => {
        await list();
        expect(fakePrisma.oauthGrant.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: ME, revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
        );
        for (let i = 0; i < 55; i++) addGrant({ id: `g${i}`, userId: ME, createdAt: at(i) });
        expect(((await list()).json.grants as unknown[]).length).toBe(50);
    });

    it('answers 401 signed out, reading nothing', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expect((await list()).status).toBe(401);
        expect(fakePrisma.oauthGrant.findMany).not.toHaveBeenCalled();
    });

    it('is rate limited and rendered per request', async () => {
        h.rateLimit.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
        expect((await list()).status).toBe(429);
        expect(dynamic).toBe('force-dynamic');
    });
});

describe('DELETE', () => {
    it("revokes the caller's grant (user_revoke) and deletes its refresh tokens", async () => {
        addGrant({ id: 'g-mine', userId: ME });
        addGrant({ id: 'g-other', userId: ME });
        addRefreshToken({ tokenHash: 'h1', grantId: 'g-mine' });
        addRefreshToken({ tokenHash: 'h2', grantId: 'g-other' });

        const { status, json } = await remove({ grantId: 'g-mine' });
        expect(status).toBe(200);
        expect(json).toEqual({ revoked: true });
        const mine = db.grants.find((grant) => grant.id === 'g-mine');
        expect(mine?.revokedAt).toBeInstanceOf(Date);
        expect(mine?.revokedReason).toBe('user_revoke');
        expect(db.refreshTokens.map((row) => row.tokenHash)).toEqual(['h2']);
        expect(db.grants.find((grant) => grant.id === 'g-other')?.revokedAt).toBeNull();
    });

    it("answers 404 for another user's grant and leaves it alone", async () => {
        addGrant({ id: 'g-theirs', userId: 'user-2' });
        addRefreshToken({ tokenHash: 'h1', grantId: 'g-theirs' });
        const { status } = await remove({ grantId: 'g-theirs' });
        expect(status).toBe(404);
        expect(db.grants[0].revokedAt).toBeNull();
        expect(db.refreshTokens).toHaveLength(1);
        expect(fakePrisma.oauthGrant.updateMany).toHaveBeenCalledWith({
            where: { id: 'g-theirs', userId: ME, revokedAt: null },
            data: { revokedAt: expect.any(Date), revokedReason: 'user_revoke' },
        });
    });

    it('answers 404 for a missing or already revoked grant', async () => {
        addGrant({ id: 'g-gone', userId: ME, revokedAt: at(1), revokedReason: 'client_revoke' });
        expect((await remove({ grantId: 'g-gone' })).status).toBe(404);
        expect(db.grants[0].revokedReason).toBe('client_revoke');
        expect((await remove({ grantId: 'nope' })).status).toBe(404);
    });

    it('answers 400 for a grant id that is not a plain short string, before any query', async () => {
        for (const body of [{}, { grantId: '' }, { grantId: 42 }, { grantId: { not: '' } }, { grantId: ['g'] }, { grantId: 'g'.repeat(65) }, 'not json', null]) {
            expect((await remove(body)).status, JSON.stringify(body)).toBe(400);
        }
        expect(fakePrisma.oauthGrant.updateMany).not.toHaveBeenCalled();
    });

    it('answers 401 signed out', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        addGrant({ id: 'g-mine', userId: ME });
        expect((await remove({ grantId: 'g-mine' })).status).toBe(401);
        expect(db.grants[0].revokedAt).toBeNull();
    });
});

describe('the Settings card', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/settings/ConnectedAppsSection.tsx'), 'utf8');

    it('says the design 2.10 copy, with no dashes', () => {
        for (const copy of ['Connected apps', 'Connected {formatDate(app.createdAt)}', '`Last used ${formatDate(app.lastUsedAt)}`', "'Not used yet'", 'Remove access', 'No apps are connected.']) {
            expect(src, copy).toContain(copy);
        }
        expect(dashesIn(src)).toEqual([]);
    });

    it('is rendered in the Account tab for job seekers, after the AI digest toggle', () => {
        const settings = fs.readFileSync(path.join(process.cwd(), 'app/settings/page.tsx'), 'utf8');
        const toggle = settings.indexOf('<AIRecommendationsToggle />');
        const section = settings.indexOf("{profile.role === 'job_seeker' && <ConnectedAppsSection />}");
        expect(toggle).toBeGreaterThan(-1);
        expect(section).toBeGreaterThan(toggle);
        expect(settings.slice(settings.indexOf("activeTab === 'account'"), section)).toContain('<AIRecommendationsToggle />');
    });
});

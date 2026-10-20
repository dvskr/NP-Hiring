/**
 * PATCH /api/auth/profile: a deleted account cannot put itself back in the
 * talent pool.
 *
 * A soft-deleted account keeps its session through the 30 day grace period,
 * and the settings page sends openToOffers and profileVisible on every save
 * (app/settings/page.tsx). Switching either on wrote it, so the account was
 * listed in every pool site again with deletedAt still set. Switching on now
 * waits for a restore; switching off, and every other field, still saves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const h = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { PATCH } from '@/app/api/auth/profile/route';

const USER = 'aaaaaaaa-1111-2222-3333-444444444444';

function patch(body: Record<string, unknown>): NextRequest {
    return new NextRequest('https://nphiring.com/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** The data object the PATCH wrote. */
async function written(body: Record<string, unknown>, deletedAt: Date | null): Promise<Record<string, unknown>> {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ deletedAt } as never);
    vi.mocked(prisma.userProfile.update).mockResolvedValue({ id: 'profile-1', supabaseId: USER } as never);
    const res = await PATCH(patch(body));
    expect(res.status).toBe(200);
    const [{ data }] = vi.mocked(prisma.userProfile.update).mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    return data;
}

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: USER, email: 'seeker@example.com' } }, error: null });
});

describe('PATCH /api/auth/profile: the visibility switches of a deleted account', () => {
    it('does not switch either one on while the account is deleted', async () => {
        const data = await written({ openToOffers: true, profileVisible: true, headline: 'FNP' }, new Date('2026-10-10'));
        expect(data).not.toHaveProperty('openToOffers');
        expect(data).not.toHaveProperty('profileVisible');
        expect(data.headline).toBe('FNP');
    });

    it('still switches them off', async () => {
        const data = await written({ openToOffers: false, profileVisible: false }, new Date('2026-10-10'));
        expect(data.openToOffers).toBe(false);
        expect(data.profileVisible).toBe(false);
    });

    it('switches them on for a live account', async () => {
        const data = await written({ openToOffers: true, profileVisible: true }, null);
        expect(data.openToOffers).toBe(true);
        expect(data.profileVisible).toBe(true);
    });
});

/**
 * /admin/users can restore a deactivated profile.
 *
 * Deactivating (DELETE /api/admin/users/:id) hides a profile from employers,
 * and the only way back used to be a hand-made request. A hidden profile's
 * row now offers Restore in place of Deactivate. Restoring is a PATCH of
 * profileVisible: true, which the API already accepts.
 *
 * profileVisible is also the member's own privacy switch, so a hidden profile
 * may be the member's choice rather than an admin's: the control asks first,
 * every time, and says that restoring overrides that choice. It never turns
 * openToOffers back on, which is the member's preference alone.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UserVisibilityAction from '@/app/admin/users/UserVisibilityAction';
import { RESTORE_PROFILE_CONFIRMATION, restoreProfileVisibility } from '@/app/admin/users/restore-profile';
import { readCode } from '../helpers/source';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
});

function stubFetch(body: unknown, status: number): ReturnType<typeof vi.fn> {
    const spy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
}

const noop = () => undefined;

describe('the row action', () => {
    it('offers Restore, and not Deactivate, on a hidden profile', () => {
        const html = renderToStaticMarkup(createElement(UserVisibilityAction, {
            profileVisible: false, onDeactivate: noop, onRestore: noop,
        }));
        expect(html).toContain('aria-label="Restore this profile"');
        expect(html).toMatch(/>\s*Restore\s*<\/button>/);
        expect(html).not.toContain('Deactivate user');
    });

    it('offers Deactivate, and not Restore, on a visible profile', () => {
        const html = renderToStaticMarkup(createElement(UserVisibilityAction, {
            profileVisible: true, onDeactivate: noop, onRestore: noop,
        }));
        expect(html).toContain('aria-label="Deactivate user"');
        expect(html).not.toContain('Restore');
    });
});

describe('restoring a profile', () => {
    it('asks first, warning that it overrides the member\'s own privacy choice', async () => {
        const fetchSpy = stubFetch({ success: true }, 200);
        const confirmRestore = vi.fn(() => false);

        const outcome = await restoreProfileVisibility('clx0000000000000000fic1', confirmRestore);

        expect(confirmRestore).toHaveBeenCalledWith(RESTORE_PROFILE_CONFIRMATION);
        expect(RESTORE_PROFILE_CONFIRMATION).toMatch(/hid it themselves/);
        expect(RESTORE_PROFILE_CONFIRMATION).toMatch(/overrides their privacy choice/);
        expect(RESTORE_PROFILE_CONFIRMATION).not.toMatch(new RegExp('[\\u2013\\u2014]'));
        // Declined: nothing is sent.
        expect(outcome).toEqual({ status: 'cancelled' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('once confirmed, sends one PATCH that makes the profile visible and touches nothing else', async () => {
        const fetchSpy = stubFetch({ success: true, user: { id: 'clx0000000000000000fic1', profileVisible: true } }, 200);

        const outcome = await restoreProfileVisibility('clx0000000000000000fic1', () => true);

        expect(outcome).toEqual({ status: 'restored' });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/admin/users/clx0000000000000000fic1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({ profileVisible: true });
    });

    it('reports a refused restore with the server\'s reason', async () => {
        stubFetch({ success: false, error: 'User not found' }, 404);
        const outcome = await restoreProfileVisibility('clx0000000000000000fic2', () => true);
        expect(outcome).toEqual({ status: 'failed', error: 'User not found' });
    });

    it('reports a request that never reached the server', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;
        const outcome = await restoreProfileVisibility('clx0000000000000000fic3', () => true);
        expect(outcome.status).toBe('failed');
        if (outcome.status === 'failed') expect(outcome.error).toContain('Failed to fetch');
    });
});

describe('/admin/users wiring', () => {
    const src = readCode('app/admin/users/page.tsx');

    it('renders the row action with both handlers', () => {
        expect(src).toMatch(/<UserVisibilityAction[\s\S]{0,200}?profileVisible=\{user\.profileVisible\}/);
        expect(src).toMatch(/onRestore=\{\(\) => \{ void restoreUser\(user\.id\); \}\}/);
        expect(src).toMatch(/onDeactivate=\{\(\) => \{ void deactivateUser\(user\.id\); \}\}/);
    });

    it('restores through the confirming helper, and only marks the row visible after it succeeded', () => {
        const start = src.indexOf('const restoreUser = async');
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, src.indexOf('\n    const ', start + 1));
        expect(body).toMatch(/restoreProfileVisibility\(userId, \(message\) => window\.confirm\(message\)\)/);
        const failed = body.indexOf("outcome.status === 'failed'");
        const marked = body.indexOf('profileVisible: true');
        expect(failed).toBeGreaterThan(-1);
        expect(marked).toBeGreaterThan(failed);
        expect(body).not.toMatch(/openToOffers: true/);
    });
});

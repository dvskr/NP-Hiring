/**
 * Regression guards for B16: the extension's silent token refresh
 * contradicted its own login flow's cookie model.
 *
 * The extension JWT (1h TTL, minted by /api/auth/extension-token) can only
 * be issued where the board's Supabase session cookie is attached. The
 * login flow always ran the mint fetch inside the logged-in page context;
 * the refresh path fired a bare extension-context fetch instead, so the
 * cookie never accompanied it, refresh failed silently, and sessions died
 * at the 1-hour mark.
 *
 * Guards (static source assertions on the aligned flow):
 *   - refresh shares the login flow's page-context mint (board tab +
 *     chrome.scripting), with a direct credentialed fetch only as fallback
 *   - content scripts delegate refresh to the background (their fetches
 *     originate from third-party ATS origins and can never carry the cookie)
 *   - refresh failure no longer masquerades as "logged out"
 *   - refresh cadence outpaces the server-side 1h JWT TTL
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTH = 'pmhnp-autofill-extension/src/shared/auth.ts';
const BACKGROUND = 'pmhnp-autofill-extension/src/background/index.ts';
const TYPES = 'pmhnp-autofill-extension/src/shared/types.ts';
const CONSTANTS = 'pmhnp-autofill-extension/src/shared/constants.ts';
const SERVER_ROUTE = 'app/api/auth/extension-token/route.ts';

describe('B16 — silent token refresh aligned with the login flow cookie model', () => {
    it('refresh mints the token in a board-tab page context first (login-flow model)', () => {
        const auth = read(AUTH);
        // Shared helper used by BOTH the login flow and the refresh path.
        const helperUses = auth.match(/fetchTokenInTab\(/g) ?? [];
        expect(helperUses.length, 'fetchTokenInTab must serve login AND refresh').toBeGreaterThanOrEqual(3);
        expect(auth).toContain('chrome.scripting.executeScript');
        expect(auth).toContain('refreshViaBoardTab');
        // Direct extension-context fetch survives only as a fallback.
        expect(auth).toContain('refreshViaDirectFetch');
    });

    it('content scripts delegate refresh to the background worker', () => {
        const auth = read(AUTH);
        expect(auth).toContain('canUseTabApis');
        expect(auth).toContain("{ type: 'REFRESH_TOKEN' }");

        const background = read(BACKGROUND);
        expect(background).toContain("case 'REFRESH_TOKEN'");
        expect(background).toMatch(/import \{[^}]*getExtensionToken[^}]*\} from '@\/shared\/auth'/);

        const types = read(TYPES);
        expect(types).toContain("'REFRESH_TOKEN'");
    });

    it('refresh failure throws instead of returning a fake logged-out state', () => {
        const auth = read(AUTH);
        // The old sink: catch → console.error → return { isLoggedIn: false, ... }
        expect(auth).not.toContain('getExtensionToken failed');
        // getAuthHeaders keeps a still-valid token when refresh fails and
        // only logs out once the token is genuinely expired.
        expect(auth).toContain('Silent token refresh failed');
        expect(auth).toContain('Session expired — please log in again');
        expect(auth).toMatch(/if \(expiresAt < Date\.now\(\)\) \{\s*await logout\(\);/);
    });

    it('refresh cadence outpaces the server-side 1h JWT TTL', () => {
        const server = read(SERVER_ROUTE);
        expect(server).toContain("setExpirationTime('1h')");

        const constants = read(CONSTANTS);
        const alarmMatch = constants.match(/TOKEN_REFRESH_INTERVAL = (\d+)/);
        expect(alarmMatch).not.toBeNull();
        const alarmMinutes = Number(alarmMatch![1]);

        const auth = read(AUTH);
        const thresholdMatch = auth.match(/const thirtyMinutes = (\d+) \* 60 \* 1000/);
        expect(thresholdMatch).not.toBeNull();
        const thresholdMinutes = Number(thresholdMatch![1]);

        const JWT_TTL_MINUTES = 60; // '1h' above
        // The alarm must fire at least once inside the refresh window, and
        // the window itself must open before the token dies.
        expect(alarmMinutes).toBeLessThan(thresholdMinutes);
        expect(thresholdMinutes).toBeLessThan(JWT_TTL_MINUTES);
    });
});

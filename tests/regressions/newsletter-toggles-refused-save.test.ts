/**
 * The two newsletter toggles must revert when the server refuses the save.
 *
 * POST /api/newsletter now refuses an opt-out without the address owner's
 * session (401, 403; see tests/api/newsletter-optout-session.test.ts), and
 * the rate limit answers 429. Both settings toggles flipped the switch
 * optimistically and reverted only when fetch itself threw, so a refused
 * opt-out left the switch showing "off" while the address stayed subscribed.
 *
 * Pinned, for the candidate toggle (components/settings/NewsletterPreference)
 * and the employer toggle (app/employer/settings/EmployerSettingsClient):
 *   - the POST's response is checked with res.ok;
 *   - a refused save reverts the switch and shows an error;
 *   - a 401 asks the user to sign in again;
 *   - a network failure still reverts.
 *
 * Static source reads, as in saved-candidates-null-posting.test.ts: the
 * vitest environment is node only and the repo has no DOM harness to mount
 * the components.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Source of one handler: from its declaration up to the next marker. */
function slice(src: string, start: string, end: string): string {
    const from = src.indexOf(start);
    expect(from, `${start} not found`).toBeGreaterThan(-1);
    const to = src.indexOf(end, from + start.length);
    expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
    return src.slice(from, to);
}

const SIGN_IN_AGAIN = 'Please sign in again to change this setting.';

describe('NewsletterPreference (candidate settings)', () => {
    const src = read('components/settings/NewsletterPreference.tsx');
    const handler = slice(src, 'const handleToggle', 'return (');

    it('checks the POST response and reverts a refused save', () => {
        expect(handler).toContain("fetch('/api/newsletter'");
        expect(handler).toMatch(/const res = await fetch\('\/api\/newsletter'/);
        expect(handler).toMatch(/if \(!res\.ok\) \{[^}]*setOptIn\(!next\)/);
    });

    it('asks for a fresh sign-in on a 401 and shows the error', () => {
        expect(handler).toMatch(/res\.status === 401/);
        expect(handler).toContain(SIGN_IN_AGAIN);
        expect(src).toMatch(/\{error && \(/);
    });

    it('still reverts when the request itself fails', () => {
        expect(handler).toMatch(/\} catch \{[^}]*setOptIn\(!next\)/);
    });
});

describe('EmployerSettingsClient (employer settings)', () => {
    const src = read('app/employer/settings/EmployerSettingsClient.tsx');
    const handler = slice(src, 'const handleNewsletterToggle', 'const handleNotifToggle');

    it('checks the POST response and reverts a refused save', () => {
        expect(handler).toMatch(/const res = await fetch\('\/api\/newsletter'/);
        expect(handler).toMatch(/if \(!res\.ok\) \{[^}]*setNewsletterOptIn\(!newState\)/);
    });

    it('asks for a fresh sign-in on a 401 and shows the error', () => {
        expect(handler).toMatch(/res\.status === 401/);
        expect(handler).toContain(SIGN_IN_AGAIN);
        expect(handler).toMatch(/showMsg\('error'/);
    });

    it('still reverts when the request itself fails', () => {
        expect(handler).toMatch(/\} catch \{[^}]*setNewsletterOptIn\(!newState\)/);
    });
});

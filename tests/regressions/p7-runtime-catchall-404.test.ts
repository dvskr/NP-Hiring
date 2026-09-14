/**
 * P7 runtime fix D5 (MEDIUM), superseded by P10 platform-routing-db #2/#4.
 *
 * P7 kept app/[...catchall]/page.tsx and made it force-dynamic so unmatched
 * URLs would reach the branded app/not-found.tsx. The P10 E2E run showed that
 * was still wrong under `next start` (Next 16.1.6): a notFound() thrown from
 * a matched route renders the bare `<html id="__next_error__">` shell in the
 * server HTML, and the single-segment app/[indexnow]/route.ts turned every
 * unknown top-level URL into a 0-byte 404. A vanilla Next 16.1.6 app with the
 * same catch-all reproduced the shell, while an UNMATCHED URL is served the
 * prerendered /_not-found page with the full root layout and H1.
 *
 * The contract is therefore: no top-level catch-all routes at all, so every
 * unmatched URL reaches Next's own not-found handling. The IndexNow key file
 * moved to middleware.ts (see tests/regressions/p10-platform-routing-db-fixes.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('D5 / P10 — unmatched URLs render the branded not-found page', () => {
    it('there is no catch-all page route', () => {
        expect(fs.existsSync(path.join(ROOT, 'app/[...catchall]/page.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, 'app/[[...catchall]]/page.tsx'))).toBe(false);
    });

    it('there is no single-segment dynamic route at the app root', () => {
        const dynamicTopLevel = fs
            .readdirSync(path.join(ROOT, 'app'))
            .filter((name) => name.startsWith('['));
        expect(dynamicTopLevel).toEqual([]);
    });

    it('the branded app/not-found.tsx still exists with real recovery UI', () => {
        const notFound = read('app/not-found.tsx');
        expect(notFound).toMatch(/<h1/i);
        expect(notFound).toMatch(/href=/);
    });
});

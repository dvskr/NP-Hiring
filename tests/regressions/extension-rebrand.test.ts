/**
 * Regression guards for B7: the autofill Chrome extension was donor-branded
 * and hardwired to pmhnphiring.com, making the board's autofill API routes
 * unreachable by any client.
 *
 * Guards:
 *   - no donor domain (pmhnphiring.com) anywhere in the extension source
 *   - extension board identity mirrors config/brand.ts (the extension
 *     builds standalone and cannot import the app config, so the values
 *     are duplicated and must stay in lockstep)
 *   - manifest and user-visible surfaces carry the NP Hiring brand
 *   - every API endpoint the extension declares maps to a real app route
 *
 * Internal identifiers (storage keys `pmhnp_*`, alarm names, DOM ids,
 * `[PMHNP]` log prefixes) are functional, non-user-visible identifiers and
 * are deliberately allowed — same policy as shell-brand-remnants.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EXT_SRC = path.join(ROOT, 'pmhnp-autofill-extension', 'src');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, exts));
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

describe('B7 — extension rebranded from donor board to NP Hiring', () => {
    it('no file in the extension source references the donor domain', () => {
        const files = walk(EXT_SRC, ['.ts', '.tsx', '.html', '.css', '.json']);
        expect(files.length).toBeGreaterThan(20);
        const offenders = files.filter((f) =>
            /pmhnphiring/i.test(fs.readFileSync(f, 'utf8'))
        );
        expect(offenders, 'donor domain still referenced').toEqual([]);
    });

    it('extension BOARD_DOMAIN / production API base mirror config/brand.ts', () => {
        const constants = read('pmhnp-autofill-extension/src/shared/constants.ts');
        const brand = read('config/brand.ts');

        const domainMatch = constants.match(/BOARD_DOMAIN = '([^']+)'/);
        expect(domainMatch, 'constants.ts must export BOARD_DOMAIN').not.toBeNull();

        const brandDomainMatch = brand.match(/domain: '([^']+)'/);
        expect(brandDomainMatch).not.toBeNull();
        expect(domainMatch![1]).toBe(brandDomainMatch![1]);

        // Production base URL derives from BOARD_DOMAIN (single source inside the extension).
        expect(constants).toContain('`https://${BOARD_DOMAIN}`');
        // The lockstep comment pointing at the app's source of truth.
        expect(constants).toContain('config/brand.ts');
    });

    it('manifest carries the NP Hiring brand and board host permissions', () => {
        const manifest = read('pmhnp-autofill-extension/src/manifest.ts');
        expect(manifest).toContain("name: 'NP Hiring — Autofill Agent'");
        expect(manifest).toContain("'https://nphiring.com/*'");
        expect(manifest).toContain("'https://www.nphiring.com/*'");
        expect(manifest).not.toMatch(/PMHNP|Psychiatric/);
    });

    it('user-visible surfaces carry no donor-niche copy', () => {
        expect(read('pmhnp-autofill-extension/src/popup/index.html')).not.toMatch(/PMHNP/);
        expect(read('pmhnp-autofill-extension/src/sidebar/index.html')).not.toMatch(/PMHNP/);

        const app = read('pmhnp-autofill-extension/src/popup/App.tsx');
        expect(app).toContain('Autofill NP job applications in seconds');
        expect(app).toContain('Login to {BOARD_DOMAIN}');
        expect(app).toContain('{BOARD_NAME}');

        const settings = read('pmhnp-autofill-extension/src/popup/Settings.tsx');
        expect(settings).toContain('{BOARD_NAME} Autofill');
        expect(settings).toContain('href={SETTINGS_URL}');
        expect(settings).toContain('href={SUPPORT_URL}');

        const fab = read('pmhnp-autofill-extension/src/content/fab.ts');
        expect(fab).toContain('aria-label="NP Hiring Autofill"');
    });

    it('SUPPORT_URL points at a route that exists (/contact — the board has no /support)', () => {
        const constants = read('pmhnp-autofill-extension/src/shared/constants.ts');
        expect(constants).toContain('SUPPORT_URL = `${API_BASE_URL}/contact`');
        expect(
            fs.existsSync(path.join(ROOT, 'app', 'contact', 'page.tsx')),
            'app/contact/page.tsx must exist for the extension support link'
        ).toBe(true);
    });

    it('every declared API endpoint maps to an existing app route', () => {
        const constants = read('pmhnp-autofill-extension/src/shared/constants.ts');
        const endpoints = [...constants.matchAll(/ENDPOINT = '(\/api\/[^']+)'/g)].map(
            (m) => m[1]
        );
        // 8 autofill-adjacent routes: profile export, extension token,
        // generate-answer, cover-letter, bulk, classify, extract-sections,
        // track, usage (telemetry is declared in telemetry.ts, checked below).
        expect(endpoints.length).toBeGreaterThanOrEqual(9);

        for (const endpoint of endpoints) {
            const routeFile = path.join(ROOT, 'app', ...endpoint.split('/').filter(Boolean), 'route.ts');
            expect(fs.existsSync(routeFile), `${endpoint} has no app route at ${routeFile}`).toBe(true);
        }

        const telemetry = read('pmhnp-autofill-extension/src/shared/telemetry.ts');
        expect(telemetry).toContain('/api/autofill/telemetry');
        expect(
            fs.existsSync(path.join(ROOT, 'app', 'api', 'autofill', 'telemetry', 'route.ts'))
        ).toBe(true);
    });

    it('document proxy detection uses BOARD_DOMAIN, not a hardcoded host', () => {
        const documents = read('pmhnp-autofill-extension/src/content/documents.ts');
        expect(documents).toContain('doc.fileUrl.includes(BOARD_DOMAIN)');
    });
});

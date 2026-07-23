/**
 * Regression guard for B61 — no blocking alert() calls for mutation feedback.
 *
 * The global ToastProvider is mounted in app/layout.tsx but feedback was a
 * patchwork of window.alert() calls (blocking, unstyled, screen-reader
 * hostile). This pins the five converted surfaces to the shared toast and
 * ratchets `alert(` to zero across app/ and components/ so new call sites
 * can't sneak back in. Destructive-action confirms stay on ConfirmDialog —
 * only alert() is banned here, not confirm-flow dialogs.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CONVERTED = [
    'app/messages/page.tsx',
    'app/post-job/page.tsx',
    'app/jobs/edit/[token]/page.tsx',
    'app/admin/outreach/page.tsx',
    'components/employer/EmployerDashboardClient.tsx',
];

// Bare word-boundary alert( call — excludes createAlert(, showAlert(, etc.
const ALERT_CALL = /(?<![A-Za-z0-9_.])alert\(/;

function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...listSourceFiles(rel));
        else if (/\.(tsx|ts)$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('B61 — converted surfaces use the shared ToastProvider', () => {
    it.each(CONVERTED)('%s imports useToast and never calls alert()', (rel) => {
        const src = read(rel);
        expect(src).toContain("from '@/components/ui/ToastProvider'");
        expect(ALERT_CALL.test(src)).toBe(false);
    });

    it('ToastProvider stays mounted at the root layout', () => {
        const layout = read('app/layout.tsx');
        expect(layout).toContain('<ToastProvider>');
        expect(layout).toContain('</ToastProvider>');
    });
});

describe('B61 — alert() ratchet: zero blocking alerts in app/ and components/', () => {
    it('no .ts/.tsx file under app/ or components/ calls window alert()', () => {
        const offenders: string[] = [];
        for (const rel of [...listSourceFiles('app'), ...listSourceFiles('components')]) {
            const src = read(rel);
            if (ALERT_CALL.test(src)) offenders.push(rel);
        }
        expect(offenders, `alert() reintroduced in: ${offenders.join(', ')}`).toEqual([]);
    });
});

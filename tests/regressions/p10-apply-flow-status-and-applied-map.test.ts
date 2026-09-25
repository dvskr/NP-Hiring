/**
 * P10 apply-flow regressions (non-UI logic).
 *
 *  2. Re-applying after a withdrawal left status 'withdrawn' (apply-direct
 *     cleared withdrawnAt only).
 *  3. useAppliedJobs counted withdrawn rows as applied, so the job page CTA
 *     read "Apply Again" after a withdrawal.
 *  4. useFocusTrap restored focus to a detached node (focus fell to <body>).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildApplicationStatusFields,
    isWithdrawnApplication,
} from '@/app/api/applications/apply-direct/status-fields';
import { buildServerAppliedMap, findLocalOnlyJobIds } from '@/lib/hooks/useAppliedJobs';
import { resolveReturnFocusTarget } from '@/lib/hooks/useFocusTrap';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const NOW = new Date('2026-09-13T12:00:00Z');

describe('P10 defect 2: apply-direct status on re-apply', () => {
    it('re-applying after a withdrawal returns the status to applied', () => {
        const fields = buildApplicationStatusFields(
            { status: 'withdrawn', withdrawnAt: new Date('2026-09-01') },
            false,
            '',
            NOW,
        );
        expect(fields).toEqual({ status: 'applied', statusUpdatedAt: NOW });
    });

    it('treats a withdrawn status without withdrawnAt as withdrawn too', () => {
        expect(isWithdrawnApplication({ status: 'withdrawn', withdrawnAt: null })).toBe(true);
    });

    it('a knockout answer still auto-rejects, even on a re-apply', () => {
        const fields = buildApplicationStatusFields(
            { status: 'withdrawn', withdrawnAt: NOW },
            true,
            'Does not meet requirement: License?',
            NOW,
        );
        expect(fields.status).toBe('rejected');
        expect(fields.notes).toBe('Auto-rejected: Does not meet requirement: License?');
        expect(fields.statusUpdatedAt).toBe(NOW);
    });

    it('resubmitting an active application keeps the employer pipeline status', () => {
        expect(buildApplicationStatusFields({ status: 'interview', withdrawnAt: null }, false, '', NOW)).toEqual({});
    });

    it('a new application relies on the schema default', () => {
        expect(buildApplicationStatusFields(null, false, '', NOW)).toEqual({});
    });

    it('the route spreads the status fields into both upsert branches', () => {
        const src = read('app/api/applications/apply-direct/route.ts');
        expect(src).toContain("import { buildApplicationStatusFields } from './status-fields'");
        expect(src.split('...statusFields,').length - 1).toBe(2);
        expect(src).toContain('withdrawnAt: null');
    });
});

describe('P10 defect 3: useAppliedJobs ignores withdrawn applications', () => {
    const rows = [
        { jobId: 'active', appliedAt: '2026-09-01T00:00:00Z', status: 'applied', withdrawnAt: null },
        { jobId: 'gone', appliedAt: '2026-09-02T00:00:00Z', status: 'withdrawn', withdrawnAt: '2026-09-03T00:00:00Z' },
        { jobId: 'legacy', appliedAt: '2026-09-04T00:00:00Z' },
    ];

    it('builds the applied map from non-withdrawn rows only', () => {
        expect(buildServerAppliedMap(rows)).toEqual({
            active: '2026-09-01T00:00:00Z',
            legacy: '2026-09-04T00:00:00Z',
        });
    });

    it('does not migrate a stale local entry for a withdrawn job back up', () => {
        const local = { gone: '2026-09-02T00:00:00Z', newLocal: '2026-09-05T00:00:00Z' };
        expect(findLocalOnlyJobIds(local, rows)).toEqual(['newLocal']);
    });
});

describe('P10 defect 4: focus restore never targets a detached node', () => {
    const body = { focus: () => {}, isConnected: true };

    it('returns the previously focused element while it is attached', () => {
        const btn = { focus: () => {}, isConnected: true };
        expect(resolveReturnFocusTarget(btn, body)).toBe(btn);
    });

    it('returns null for a detached node or <body>', () => {
        expect(resolveReturnFocusTarget({ focus: () => {}, isConnected: false }, body)).toBeNull();
        expect(resolveReturnFocusTarget(body, body)).toBeNull();
        expect(resolveReturnFocusTarget(null, body)).toBeNull();
    });

    it('ApplyButton re-focuses the live Apply button when focus fell to body', () => {
        const src = read('components/ApplyButton.tsx');
        expect(src).toContain('ref={applyButtonRef}');
        expect(src).toMatch(/active === document\.body\)\s*\{\s*applyButtonRef\.current\?\.focus\(\);/);
    });

    it('an Easy Apply click before auth resolves is held, never swapping the button for the gate', () => {
        const src = read('components/ApplyButton.tsx');
        expect(src).toMatch(/if \(applyOnPlatform && !authResolved\) \{\s*setPendingPlatformApply\(true\);\s*return;/);
        expect(src).toContain('}, [pendingPlatformApply, authResolved, authed, jobId]);');
    });

    it('the trap effect no longer re-arms on every onEscape identity change', () => {
        const hook = read('lib/hooks/useFocusTrap.ts');
        expect(hook).toContain('}, [isOpen]);');
        expect(hook).toContain('onEscapeRef.current = onEscape');
    });
});

describe('P10 defects 1, 5, 6: apply modal UI wiring', () => {
    const button = read('components/ApplyButton.tsx');
    const form = read('components/InPlatformApplyForm.tsx');

    it('success keeps the modal mounted so the confirmation renders', () => {
        const start = button.search(/const handlePlatformApplySuccess = \([^)]*\) => \{/);
        const end = button.indexOf('\n  };', start);
        expect(start).toBeGreaterThan(-1);
        expect(button.slice(start, end)).not.toContain('setShowPlatformApply(false)');
    });

    it('submit waits for the screening questions to load', () => {
        expect(form).toContain('disabled={submitting || uploadingResume || loadingQuestions || !consentGiven}');
        expect(form).toMatch(/finally \{\s*setLoadingQuestions\(false\);/);
        expect(form).toContain('if (loadingQuestions) return;');
    });

    it('the sign-in gate button meets the 44px touch target', () => {
        expect(button).toContain('py-3 min-h-[44px] rounded-xl font-semibold');
        expect(button).not.toContain('w-full py-2.5 rounded-xl font-semibold');
    });
});

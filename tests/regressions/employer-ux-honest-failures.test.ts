/**
 * Regression guards for employer-dashboard "honest failure" fixes.
 *
 * F16 — ApplicantsTab: status changes / notes saves / bulk updates must not
 * fail silently, and a broken applicants fetch must never render as "no
 * applicants yet".
 * V2 — EmployerDashboardClient: Pause/Republish and Archive/Restore must
 * surface failures instead of swallowing them, and the pause-reason modal
 * must stay open when the submit fails.
 *
 * These are static source assertions (mirroring audit-mediums-static.test.ts)
 * because the vitest environment is node-only — no DOM/RTL harness exists in
 * this repo to mount the components.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const applicantsTab = read('components/employer/ApplicantsTab.tsx');
const dashboard = read('components/employer/EmployerDashboardClient.tsx');

describe('F16: ApplicantsTab surfaces failures instead of swallowing them', () => {
    it('wires the shared toast system', () => {
        expect(applicantsTab).toContain("import { useToast } from '@/components/ui/ToastProvider'");
        expect(applicantsTab).toContain('const { toast } = useToast()');
    });

    it('fetch failure sets a dedicated error state, not just an empty list', () => {
        expect(applicantsTab).toContain('setFetchError(');
        // The old silent mapping of non-OK responses to empty arrays is gone.
        expect(applicantsTab).not.toMatch(/if \(!res\.ok\) \{ setApplicants\(\[\]\); setJobs\(\[\]\); return; \}/);
        // Non-OK and empty-body responses are treated as errors.
        expect(applicantsTab).toMatch(/throw new Error\(`Applicants request failed \(\$\{res\.status\}\)`\)/);
        expect(applicantsTab).toContain('Applicants request returned an empty response');
    });

    it('renders an error panel with a Retry button distinct from the empty state', () => {
        expect(applicantsTab).toMatch(/fetchError \? \(/);
        expect(applicantsTab).toContain('Couldn&apos;t load applicants');
        expect(applicantsTab).toMatch(/void fetchApplicants\(\)/);
        expect(applicantsTab).toContain('Retry');
        // The genuinely-empty state still exists as a separate branch.
        expect(applicantsTab).toContain('No applicants ');
    });

    it('status change rolls back the optimistic update and toasts on failure', () => {
        expect(applicantsTab).toContain('const performStatusChange = async');
        // Snapshot taken before the optimistic update...
        expect(applicantsTab).toMatch(/const previous = \{ status: target\.status, statusUpdatedAt: target\.statusUpdatedAt \}/);
        // ...and explicitly restored in the failure path.
        expect(applicantsTab).toMatch(/status: previous\.status, statusUpdatedAt: previous\.statusUpdatedAt/);
        // Non-OK responses are promoted to errors, not ignored.
        expect(applicantsTab).toMatch(/data\.error \|\| `Status update failed \(\$\{res\.status\}\)`/);
        // Single status change reports the failure to the user.
        expect(applicantsTab).toContain('Couldn’t update applicant status — please try again.');
    });

    it('notes save toasts on failure and keeps the editor open', () => {
        expect(applicantsTab).toContain('Couldn’t save notes — please try again.');
        // setEditingNotes(null) after a save must only happen on the success
        // path: assert it is not inside the catch block of handleSaveNotes.
        const saveNotes = applicantsTab.slice(
            applicantsTab.indexOf('const handleSaveNotes'),
            applicantsTab.indexOf('const getStatusInfo'),
        );
        expect(saveNotes.length).toBeGreaterThan(0);
        // Anchor on the try/catch clause, not the `.catch(` on res.json().
        const catchBlock = saveNotes.slice(saveNotes.indexOf('} catch (err)'));
        expect(catchBlock).not.toContain('setEditingNotes(null)');
    });

    it('bulk status change reports partial failures and keeps failed rows selected', () => {
        expect(applicantsTab).toMatch(/\$\{failedIds\.length\} of \$\{ids\.length\} status updates failed/);
        expect(applicantsTab).toContain('setSelectedIds(new Set(failedIds))');
        // Bulk fans out to the non-toasting core, not the per-row toaster.
        expect(applicantsTab).toMatch(/ids\.map\(id => performStatusChange\(id, newStatus\)\)/);
    });
});

describe('V2: EmployerDashboardClient Pause/Republish and Archive/Restore fail loudly', () => {
    it('wires the shared toast system', () => {
        expect(dashboard).toContain("import { useToast } from '@/components/ui/ToastProvider'");
        expect(dashboard).toContain('const { toast } = useToast()');
    });

    it('no silent catch blocks remain', () => {
        expect(dashboard).not.toMatch(/catch \{ \/\* silent \*\/ \}/);
    });

    it('toggle-publish surfaces failures and prefers the server message', () => {
        expect(dashboard).toMatch(/result\.message \|\| result\.error \|\| `Request failed \(\$\{res\.status\}\)`/);
        expect(dashboard).toContain('Couldn’t pause this job — please try again.');
        expect(dashboard).toContain('Couldn’t republish this job — please try again.');
    });

    it('pause-reason modal only closes on success', () => {
        const toggle = dashboard.slice(
            dashboard.indexOf('const performTogglePublish'),
            dashboard.indexOf('const submitUnpublish'),
        );
        expect(toggle.length).toBeGreaterThan(0);
        // The modal-close call sits before the try/catch's catch clause
        // (success path only). Anchor on `} catch` so the `.catch(` on
        // res.json() doesn't false-match.
        const closeIdx = toggle.indexOf('setUnpublishTarget(null)');
        const catchIdx = toggle.indexOf('} catch (err)');
        expect(closeIdx).toBeGreaterThan(-1);
        expect(catchIdx).toBeGreaterThan(-1);
        expect(closeIdx).toBeLessThan(catchIdx);
        // ...and is not in the finally block (the old regression).
        const finallyBlock = toggle.slice(toggle.indexOf('finally'));
        expect(finallyBlock).not.toContain('setUnpublishTarget(null)');
    });

    it('archive/restore surfaces failures', () => {
        expect(dashboard).toContain('Couldn’t archive this job — please try again.');
        expect(dashboard).toContain('Couldn’t restore this job — please try again.');
        const archive = dashboard.slice(
            dashboard.indexOf('const performArchiveToggle'),
            dashboard.indexOf('const handleRenewCheckout'),
        );
        expect(archive.length).toBeGreaterThan(0);
        expect(archive).toMatch(/if \(!res\.ok \|\| !result\.success\)/);
    });
});

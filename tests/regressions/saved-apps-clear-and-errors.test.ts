/**
 * Regression guards for the saved-jobs / my-applications backlog fixes.
 *
 * B0  — app/saved "Clear history" must never hard-delete submitted
 *       in-platform applications (employer pipeline rows + consent
 *       records). The clear partitions server rows first and only
 *       removes pure click-through tracking entries.
 * B66 — "Clear all" saved jobs is destructive and must confirm via the
 *       shared ConfirmDialog (window.confirm is banned app-wide).
 * B57 — my-applications load failures must distinguish a real 401 from
 *       other errors (retry, not a bogus "Please sign in"), and the
 *       withdraw action must surface failures.
 * B64 — talent-search: save-candidate optimistic toggle rolls back on
 *       non-OK, and browse fetch failures render an error panel with
 *       Retry instead of silently keeping stale results.
 * B82 — job-detail SaveJobButton syncs through the auth-aware
 *       useSavedJobs hook (server POST/DELETE for signed-in users)
 *       instead of writing localStorage only.
 *
 * Static source assertions (mirroring employer-ux-honest-failures.test.ts)
 * because the vitest environment is node-only — no DOM/RTL harness exists
 * in this repo to mount the components.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const savedPage = read('app/saved/page.tsx');
const myApps = read('app/my-applications/page.tsx');
const talentSearch = read('components/employer/CandidateSearchClient.tsx');
const saveButton = read('components/SaveJobButton.tsx');

describe('B0: "Clear history" preserves submitted in-platform applications', () => {
    it('partitions server rows before clearing anything for authed users', () => {
        expect(savedPage).toContain('const clearAppliedHistory = async');
        // Reads the authoritative application rows first...
        expect(savedPage).toContain("await fetch('/api/applications')");
        // ...and builds the protected set from submitted-content markers.
        expect(savedPage).toContain('const protectedIds = new Set(');
        expect(savedPage).toContain('a.consentGiven === true');
        expect(savedPage).toContain('!!a.coverLetter');
        expect(savedPage).toContain('!!a.resumeUrl');
        expect(savedPage).toContain("a.status !== 'applied'");
        expect(savedPage).toContain('!!a.withdrawnAt');
    });

    it('only clears rows outside the protected set', () => {
        expect(savedPage).toMatch(/const clearable = appliedJobs\.filter\(\(id\) => !protectedIds\.has\(id\)\)/);
        expect(savedPage).toMatch(/for \(const id of clearable\) removeApplied\(id\)/);
        // The rendered applied grid keeps the protected rows visible.
        expect(savedPage).toMatch(/prev\.filter\(\(job\) => protectedIds\.has\(job\.id\)\)/);
    });

    it('unconditional clearAll only runs on the anonymous (401) path', () => {
        const fn = savedPage.slice(
            savedPage.indexOf('const clearAppliedHistory'),
            savedPage.indexOf('const handleClearApplied'),
        );
        expect(fn.length).toBeGreaterThan(0);
        const clearAllIdx = fn.indexOf('clearAppliedJobs()');
        const guardIdx = fn.indexOf('res.status === 401');
        expect(clearAllIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        // The blanket clear sits inside the 401 branch, after the guard.
        expect(guardIdx).toBeLessThan(clearAllIdx);
        // Exactly one blanket-clear call remains in the whole file.
        expect(savedPage.match(/clearAppliedJobs\(\)/g)?.length).toBe(1);
    });

    it('a failed partition fetch clears nothing and reports the failure', () => {
        const fn = savedPage.slice(
            savedPage.indexOf('const clearAppliedHistory'),
            savedPage.indexOf('const handleClearApplied'),
        );
        expect(fn).toMatch(/throw new Error\(`Applications request failed \(\$\{res\.status\}\)`\)/);
        const catchBlock = fn.slice(fn.indexOf('} catch'));
        expect(catchBlock).toContain('Couldn’t clear your history — please try again.');
        expect(catchBlock).not.toContain('clearAppliedJobs()');
        expect(catchBlock).not.toContain('removeApplied(');
    });

    it('the confirm copy tells the user submitted applications are kept', () => {
        expect(savedPage).toContain('Applications you submitted on this site are kept');
    });
});

describe('B66: destructive clears confirm via the shared ConfirmDialog', () => {
    it('uses ConfirmDialog, not window.confirm', () => {
        expect(savedPage).toContain("import ConfirmDialog, { ConfirmConfig } from '@/components/ui/ConfirmDialog'");
        expect(savedPage).toContain('<ConfirmDialog');
        // No native confirm calls remain (the state variable `confirm`
        // holds a ConfirmConfig object, never a call expression).
        expect(savedPage).not.toMatch(/if \(confirm\(/);
        expect(savedPage).not.toMatch(/window\.confirm\s*\(/);
    });

    it('"Clear all" saved jobs is gated behind a danger confirm', () => {
        const handler = savedPage.slice(
            savedPage.indexOf('const handleClearAll'),
            savedPage.indexOf('const clearAppliedHistory'),
        );
        expect(handler.length).toBeGreaterThan(0);
        expect(handler).toContain('Clear all saved jobs?');
        expect(handler).toContain("variant: 'danger'");
        // The destructive work only happens inside onConfirm.
        const onConfirmIdx = handler.indexOf('onConfirm:');
        const clearIdx = handler.indexOf('clearSavedJobs()');
        expect(onConfirmIdx).toBeGreaterThan(-1);
        expect(clearIdx).toBeGreaterThan(onConfirmIdx);
    });

    it('"Clear history" is also routed through the dialog', () => {
        const handler = savedPage.slice(
            savedPage.indexOf('const handleClearApplied'),
            savedPage.indexOf('const handleRemoveJob'),
        );
        expect(handler).toContain('Clear application history?');
        expect(handler).toContain("variant: 'danger'");
        expect(handler).toContain('void clearAppliedHistory()');
    });
});

describe('B57: my-applications distinguishes 401 from load failures', () => {
    it('only a real 401 renders the sign-in state', () => {
        expect(myApps).toMatch(/res\.status === 401/);
        expect(myApps).toContain("setErrorKind('auth')");
        expect(myApps).toContain("setErrorKind('load')");
        // The old blanket mislabel is gone.
        expect(myApps).not.toMatch(/\.catch\(\(\) => setError\('Please sign in/);
    });

    it('non-auth failures get a Retry button, not a sign-in link', () => {
        expect(myApps).toMatch(/errorKind === 'auth' \? 'Sign in required' : 'Something went wrong'/);
        expect(myApps).toContain('void loadApplications()');
        expect(myApps).toContain('Try Again');
        // Sign-in link only renders on the auth branch.
        expect(myApps).toMatch(/errorKind === 'auth' \? \(/);
    });

    it('non-OK responses are promoted to errors', () => {
        expect(myApps).toMatch(/throw new Error\(`Applications request failed \(\$\{res\.status\}\)`\)/);
    });

    it('withdraw failures stay surfaced (banner + no silent catch)', () => {
        expect(myApps).toContain('setWithdrawError(');
        expect(myApps).toContain('Couldn’t withdraw this application. Please try again.');
        expect(myApps).toMatch(/role="alert"/);
    });
});

describe('B64: talent-search fails loudly on save and browse', () => {
    it('save toggle rolls back the optimistic flip and toasts on failure', () => {
        const fn = talentSearch.slice(
            talentSearch.indexOf('const toggleSave'),
            talentSearch.indexOf('// Reset to page 1'),
        );
        expect(fn.length).toBeGreaterThan(0);
        // Non-OK is promoted to an error...
        expect(fn).toMatch(/if \(!res\.ok\)/);
        // ...the flip is reverted...
        expect(fn).toMatch(/if \(wasSaved\) next\.add\(candidateId\); else next\.delete\(candidateId\)/);
        // ...and the employer is told.
        expect(fn).toContain('Couldn’t save this candidate — please try again.');
        expect(fn).toContain('Couldn’t remove this saved candidate — please try again.');
    });

    it('browse fetch failures set a dedicated error state', () => {
        expect(talentSearch).toContain('const [browseError, setBrowseError]');
        // Non-OK and network failures both surface.
        expect(talentSearch).toMatch(/setBrowseError\(`Couldn’t load candidates \(request failed with status \$\{res\.status\}\)\.`\)/);
        expect(talentSearch).toContain('Couldn’t load candidates — check your connection and try again.');
        // The old silent swallow on the browse path is gone.
        const browse = talentSearch.slice(
            talentSearch.indexOf('/api/employer/candidates?'),
            talentSearch.indexOf('setLoading(false);', talentSearch.indexOf('/api/employer/candidates?')),
        );
        expect(browse).not.toContain('catch { /* silent */ }');
    });

    it('renders an error panel with Retry instead of the stale grid', () => {
        expect(talentSearch).toMatch(/browseError \? \(/);
        expect(talentSearch).toContain("Couldn&apos;t load candidates");
        expect(talentSearch).toMatch(/void fetchCandidates\(\)/);
        expect(talentSearch).toContain('Retry');
        // Successful loads (AI and browse) clear the error state.
        expect(talentSearch.match(/setBrowseError\(null\)/g)?.length).toBeGreaterThanOrEqual(2);
    });
});

describe('B82: SaveJobButton syncs through the auth-aware hook', () => {
    it('uses useSavedJobs instead of raw localStorage helpers', () => {
        expect(saveButton).toContain("import useSavedJobs from '@/lib/hooks/useSavedJobs'");
        expect(saveButton).toContain('saveJob(jobId)');
        expect(saveButton).toContain('removeJob(jobId)');
        // The localStorage-only path is gone.
        expect(saveButton).not.toMatch(/import \{[^}]*\badd\b[^}]*\} from '@\/lib\/saved-jobs'/);
    });

    it('keeps the SSR hydration guard (first client paint = unsaved)', () => {
        expect(saveButton).toContain('const [mounted, setMounted]');
        expect(saveButton).toMatch(/mounted && isJobSaved\(jobId\)/);
    });

    it('the hook it now relies on performs the server sync', () => {
        const hook = read('lib/hooks/useSavedJobs.ts');
        expect(hook).toContain("const API_PATH = '/api/saved-jobs'");
        expect(hook).toMatch(/method: 'POST'/);
        expect(hook).toMatch(/method: 'DELETE'/);
    });
});

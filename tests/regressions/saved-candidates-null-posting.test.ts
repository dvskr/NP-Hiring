/**
 * Regression guards for F33 — saved-candidate saves without a posting selected.
 *
 * POST /api/employer/saved-candidates used to upsert on the compound unique
 * [employerId, candidateId, employerJobId] with `employerJobId: postingId || null`.
 * The generated Prisma CompoundUniqueInput requires `employerJobId: string`
 * (non-null), so every posting-less save threw a Prisma validation error and
 * the route 500'd. The client never checked `res.ok`, so the optimistic heart
 * stayed flipped while nothing persisted — the save silently vanished on the
 * next page load.
 *
 * The fix:
 *  - route: posting-scoped saves keep the compound-unique upsert (all keys are
 *    strings there); posting-less "general saves" go through findFirst +
 *    update/create keyed on (employerId, candidateId, employerJobId: null),
 *    because Postgres treats NULLs as distinct and the unique index can never
 *    dedupe them anyway. Writes are wrapped in try/catch with a JSON 500.
 *  - client: toggleSave checks res.ok, reverts the optimistic toggle on any
 *    failure, and surfaces an error toast instead of swallowing it.
 *
 * These are static source assertions (mirroring employer-ux-honest-failures
 * .test.ts) because the vitest environment is node-only — no DOM/RTL harness
 * exists in this repo to mount the components, and no test DB exists to
 * exercise Prisma writes.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const route = read('app/api/employer/saved-candidates/route.ts');
const client = read('components/employer/CandidateSearchClient.tsx');

const postHandler = route.slice(
    route.indexOf('export async function POST'),
    route.indexOf('export async function DELETE'),
);

describe('F33 route: posting-less saves must not pass null into the compound unique', () => {
    it('POST handler section exists', () => {
        expect(postHandler.length).toBeGreaterThan(0);
    });

    it('never feeds `postingId || null` into the compound-unique upsert', () => {
        // The generated SavedCandidateEmployerIdCandidateIdEmployerJobIdCompoundUniqueInput
        // requires employerJobId: string — null throws at runtime. (The log
        // context legitimately uses `postingId: postingId || null`, so only
        // the employerJobId assignment is banned.)
        expect(postHandler).not.toContain('employerJobId: postingId || null');
    });

    it('keeps the compound-unique upsert for posting-scoped saves (string keys only)', () => {
        expect(postHandler).toContain('employerId_candidateId_employerJobId');
        expect(postHandler).toMatch(/if \(postingId\) \{/);
        expect(postHandler).toContain('employerJobId: postingId,');
    });

    it('general saves dedupe in code via findFirst + update/create on employerJobId: null', () => {
        expect(postHandler).toContain('savedCandidate.findFirst');
        expect(postHandler).toContain('employerJobId: null');
        expect(postHandler).toContain('savedCandidate.update');
        expect(postHandler).toContain('savedCandidate.create');
    });

    it('wraps the write in try/catch, logs, and returns a JSON 500 instead of crashing', () => {
        expect(postHandler).toContain('} catch (error) {');
        expect(postHandler).toContain("logger.error('Error saving candidate'");
        expect(postHandler).toContain("{ error: 'Failed to save candidate' }, { status: 500 }");
    });

    it('validates postingId is a string when provided', () => {
        expect(postHandler).toContain("postingId must be a string");
    });

    it('DELETE still filter-matches null (deleteMany is not the compound unique)', () => {
        const deleteHandler = route.slice(route.indexOf('export async function DELETE'));
        expect(deleteHandler).toContain('savedCandidate.deleteMany');
        expect(deleteHandler).toContain('employerJobId: postingId || null');
    });
});

describe('F33 client: toggleSave surfaces failures instead of swallowing them', () => {
    const toggleSave = client.slice(
        client.indexOf('const toggleSave'),
        client.indexOf('const prevFilters'),
    );

    it('wires the shared toast system', () => {
        expect(client).toContain("import { useToast } from '@/components/ui/ToastProvider'");
        expect(client).toContain('const { toast } = useToast()');
    });

    it('toggleSave section exists', () => {
        expect(toggleSave.length).toBeGreaterThan(0);
    });

    it('checks res.ok — a 4xx/5xx response is no longer treated as success', () => {
        expect(toggleSave).toContain('if (!res.ok)');
        expect(toggleSave).toMatch(/data\.error \|\| `Save request failed \(\$\{res\.status\}\)`/);
    });

    it('reverts the optimistic heart in the failure path', () => {
        const catchBlock = toggleSave.slice(toggleSave.indexOf('} catch'));
        expect(catchBlock).toContain('if (wasSaved) next.add(candidateId); else next.delete(candidateId);');
    });

    it('tells the employer the save/unsave failed', () => {
        expect(toggleSave).toContain('Couldn’t save this candidate — please try again.');
        expect(toggleSave).toContain('Couldn’t remove this saved candidate — please try again.');
    });
});

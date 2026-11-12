/**
 * Inline LLM rescue memory (lib/ingestion-service.ts).
 *
 * A posting below the completeness floor gets one LLM rescue. Until
 * 2026-11-12 it got one on EVERY ingest run: Greenhouse chunk 3 fetched in a
 * second and then spent 229 seconds, twice a day, re-asking the model about
 * the same 12 OnePeak Medical postings, which used the whole ingest budget.
 * The rescue is now skipped when the same posting with the same description
 * was already rejected as low-completeness inside a week.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { llmRescueAlreadyFailed } from '@/lib/ingestion-service';

describe('llmRescueAlreadyFailed', () => {
    it('skips a posting whose identical description already failed', () => {
        expect(llmRescueAlreadyFailed(1840, 1840)).toBe(true);
    });

    it('tries again when the description changed', () => {
        expect(llmRescueAlreadyFailed(1840, 2210)).toBe(false);
    });

    it('tries a posting with no earlier failure', () => {
        expect(llmRescueAlreadyFailed(undefined, 1840)).toBe(false);
    });

    it('treats an earlier empty description as a real earlier failure', () => {
        expect(llmRescueAlreadyFailed(0, 0)).toBe(true);
        expect(llmRescueAlreadyFailed(0, 500)).toBe(false);
    });
});

describe('the rescue gate reads the memory', () => {
    // The gate sits inside ingestJobs' per-job loop, reached only through a
    // full ingest run against a database, so it is pinned on the source.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/ingestion-service.ts'), 'utf-8').replace(/\r\n/g, '\n');

    it('loads this source\'s earlier failures once, before the loop', () => {
        const load = src.indexOf('const failedLlmRescues = await loadFailedLlmRescues(source);');
        const loop = src.indexOf('// Process each job');
        expect(load).toBeGreaterThan(-1);
        expect(loop).toBeGreaterThan(load);
    });

    it('does not call the model for a posting that already failed', () => {
        const gate = src.slice(src.indexOf('const rescueAlreadyFailed ='), src.indexOf('const llm = await extractWithLLM('));
        expect(gate).toContain('llmRescueAlreadyFailed(failedLlmRescues.get(normalizedJob.externalId), rawDesc.length)');
        expect(gate).toMatch(/initialScore < SOFT_COMPLETENESS_FLOOR &&\s*!rescueAlreadyFailed &&/);
    });

    it('a failed load leaves the run rescuing as before', () => {
        const fn = src.slice(src.indexOf('async function loadFailedLlmRescues('), src.indexOf('// ── Global dedup maps'));
        expect(fn).toMatch(/catch \(e\) \{[\s\S]*return new Map\(\);/);
    });
});

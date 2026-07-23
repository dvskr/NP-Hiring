/**
 * Regression guards — ai-quality enrichment loop.
 *
 * B92: extractWithLLM failures (API error, timeout, malformed JSON, missing
 *      key) must be distinguishable from "call succeeded, found nothing" —
 *      and enrich-jobs must NOT stamp lastEnrichedAt on failed attempts, or
 *      a one-hour provider outage permanently evicts every job in the window
 *      from the enrichment cohort.
 *
 * B90: enrich-thin-jds REWRITES descriptions; the original must be
 *      snapshotted before overwrite (Inngest event + CronRun.metrics copy).
 *
 * B3/B13: enrich-thin-jds must actually be scheduled — via an Inngest cron
 *      function (vercel.json is at its cron budget and owned elsewhere).
 *
 * V6:  enrichment writes mutate embedded fields — both crons must emit
 *      embedding.refresh.job so vectors track the enriched content.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractWithLLM } from '@/lib/llm-enrichment';
import { enrichThinJdsFunctions } from '@/lib/inngest/functions/enrich-thin-jds';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B92 — failed extraction attempts are marked failed', () => {
    it('returns failed:true (not a silent empty result) when no API key is configured', async () => {
        vi.stubEnv('OPENAI_API_KEY', '');
        try {
            const res = await extractWithLLM('some description', 'NP role', 'Clinic', 'Austin, TX');
            expect(res.result).toBeNull();
            expect(res.failed).toBe(true);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('enrich-jobs skips the lastEnrichedAt stamp on failed attempts', () => {
        const src = read('app/api/cron/enrich-jobs/route.ts');
        // The failure branch must exist and continue BEFORE the updateData
        // block that always writes lastEnrichedAt.
        const failedBranch = src.indexOf("'failed' in r.value && r.value.failed");
        const stampBlock = src.indexOf('lastEnrichedAt: new Date()', src.indexOf('const updateData'));
        expect(failedBranch).toBeGreaterThan(-1);
        expect(stampBlock).toBeGreaterThan(-1);
        expect(failedBranch).toBeLessThan(stampBlock);
        expect(src).toContain('leaving lastEnrichedAt unstamped');
    });

    it('every extractWithLLM exit path sets the failed flag explicitly', () => {
        const src = read('lib/llm-enrichment.ts');
        // 3 failure exits (no key, empty content, catch) + 1 success exit.
        const failedTrue = src.match(/failed: true/g) ?? [];
        expect(failedTrue.length).toBeGreaterThanOrEqual(3);
        expect(src).toContain('failed: false');
    });
});

describe('B90 — original description snapshotted before overwrite', () => {
    const src = () => read('app/api/cron/enrich-thin-jds/route.ts');

    it('emits the per-job snapshot event BEFORE the description update', () => {
        const s = src();
        const snapshotEmit = s.indexOf("name: 'job.description.snapshot'");
        const overwrite = s.indexOf('description: aiResponse.content');
        expect(snapshotEmit).toBeGreaterThan(-1);
        expect(overwrite).toBeGreaterThan(-1);
        expect(snapshotEmit).toBeLessThan(overwrite);
    });

    it('persists the durable snapshot copy in the run metrics', () => {
        const s = src();
        expect(s).toContain('originalDescription: job.description');
        expect(s).toMatch(/metrics: \{ \.\.\.stats, snapshots \}/);
    });
});

describe('B3/B13 — enrich-thin-jds is scheduled via Inngest', () => {
    it('the cron function constructs and is exported', () => {
        expect(enrichThinJdsFunctions).toHaveLength(1);
        expect(enrichThinJdsFunctions[0]).toBeTruthy();
    });

    it('is registered with the serve handler', () => {
        const serveSrc = read('app/api/inngest/route.ts');
        expect(serveSrc).toContain("from '@/lib/inngest/functions/enrich-thin-jds'");
        expect(serveSrc).toContain('...enrichThinJdsFunctions');
    });

    it('authenticates the self-call with the cron bearer secret', () => {
        const s = read('lib/inngest/functions/enrich-thin-jds.ts');
        expect(s).toContain('/api/cron/enrich-thin-jds');
        expect(s).toContain('Bearer ${cronSecret}');
        // Scheduling must NOT have gone through vercel.json (owned elsewhere).
        const vercelJson = read('vercel.json');
        expect(vercelJson).not.toContain('enrich-thin-jds');
    });
});

describe('V6 — enrichment writes refresh job embeddings', () => {
    it('enrich-jobs emits embedding.refresh.job when embedded fields change', () => {
        const s = read('app/api/cron/enrich-jobs/route.ts');
        expect(s).toContain("name: 'embedding.refresh.job'");
        // Gated on the embedded-field subset, not fired unconditionally.
        expect(s).toMatch(/EMBEDDED_FIELDS = \['setting', 'population', 'state', 'benefits'\]/);
    });

    it('enrich-thin-jds emits embedding.refresh.job after the rewrite', () => {
        const s = read('app/api/cron/enrich-thin-jds/route.ts');
        const overwrite = s.indexOf('description: aiResponse.content');
        const emit = s.indexOf("inngest.send({ name: 'embedding.refresh.job'");
        expect(emit).toBeGreaterThan(overwrite);
    });
});

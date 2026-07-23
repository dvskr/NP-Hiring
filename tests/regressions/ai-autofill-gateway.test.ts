/**
 * Regression guards for audit F28 + V4 — the 5 autofill AI endpoints must
 * route through lib/ai/gateway `complete()` with registered tasks instead of
 * raw fetch('https://api.openai.com/...') calls pinning the invalid
 * 'gpt-5.2' + temperature combo (which 502'd on every request) or the
 * deprecated/unpriced gpt-4o models.
 *
 * Gateway routing is what buys: registry-listed models, cost logging
 * (ai_call_log), timeouts, Anthropic fallback, and the circuit breaker.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TASK_REGISTRY } from '@/lib/ai/tasks';
import { hasPricing } from '@/lib/ai/pricing';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AI_ROUTES: Array<{ rel: string; task: string }> = [
    { rel: 'app/api/autofill/classify-fields/route.ts', task: 'autofill_classify' },
    { rel: 'app/api/autofill/generate-cover-letter/route.ts', task: 'cover_letter' },
    { rel: 'app/api/autofill/generate-answer/route.ts', task: 'autofill_answer' },
    { rel: 'app/api/autofill/generate-bulk/route.ts', task: 'autofill_answer' },
    { rel: 'app/api/autofill/extract-resume-sections/route.ts', task: 'autofill_resume_extract' },
];

describe('F28/V4 — autofill AI routes go through the gateway', () => {
    for (const { rel, task } of AI_ROUTES) {
        it(`${path.basename(path.dirname(rel))} imports gateway complete() and uses task '${task}'`, () => {
            const src = read(rel);
            expect(src).toMatch(/import \{ complete \} from '@\/lib\/ai\/gateway'/);
            expect(src).toContain(`task: '${task}'`);
        });

        it(`${path.basename(path.dirname(rel))} has no direct OpenAI fetch and no invalid model pin`, () => {
            const src = read(rel);
            expect(src).not.toContain("fetch('https://api.openai.com");
            expect(src).not.toMatch(/model:\s*'gpt-5\.2'/);
            expect(src).not.toMatch(/model:\s*'gpt-4o'/);
            expect(src).not.toMatch(/model:\s*'gpt-4o-mini'/);
        });
    }

    it('new autofill tasks are registered with pricing-listed models (primary + fallbacks)', () => {
        for (const task of ['autofill_classify', 'autofill_answer', 'autofill_resume_extract'] as const) {
            const config = TASK_REGISTRY[task];
            expect(config, `TASK_REGISTRY.${task} missing`).toBeDefined();
            expect(hasPricing(config.primary.model), `${task} primary ${config.primary.model} unpriced`).toBe(true);
            for (const fb of config.fallbacks) {
                expect(hasPricing(fb.model), `${task} fallback ${fb.model} unpriced`).toBe(true);
            }
            // The gateway forbids caching prompts that embed candidate PII context.
            expect(config.cacheTtlSeconds).toBe(0);
        }
    });

    it('autofill tasks have a fallback provider so a primary outage degrades, not dies', () => {
        for (const task of ['autofill_classify', 'autofill_answer', 'autofill_resume_extract'] as const) {
            expect(TASK_REGISTRY[task].fallbacks.length).toBeGreaterThan(0);
        }
    });

    it('generate-bulk surfaces an explicit per-question error field (no more silent empty answers)', () => {
        const src = read('app/api/autofill/generate-bulk/route.ts');
        // The result interface declares the error field...
        expect(src).toMatch(/interface BulkResult \{[\s\S]*?error\?: string;/);
        // ...and the failure path actually populates it.
        expect(src).toMatch(/error: message/);
        expect(src).toContain('AI generation failed');
    });
});

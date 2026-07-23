/**
 * Regression guards for audit F31 — every AI surface in this package must sit
 * behind an isAiFeatureEnabled kill switch ("every AI feature ships behind a
 * flag, killable in <1 minute"):
 *
 *   - all 5 autofill AI routes (new ai.candidate.autofill_* flags + the
 *     existing cover_letter flag)
 *   - /api/employer/ai-jd  (ai.employer.jd_generator — default flipped to
 *     true because the route is live; false made the registry lie)
 *   - /api/cron/enrich-thin-jds  (ai.platform.seo_content)
 *   - the daily recommendations Inngest cron (ai.candidate.recommendations —
 *     gating COMPUTE, not just dashboard delivery)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { listFlags } from '@/lib/ai/feature-flags';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const flagByName = () => new Map(listFlags().map((f) => [f.flag, f]));

describe('F31 — flag registry', () => {
    it('registers the four new autofill flags, default true (routes are live)', () => {
        const flags = flagByName();
        for (const name of [
            'ai.candidate.autofill_classify',
            'ai.candidate.autofill_answer',
            'ai.candidate.autofill_bulk',
            'ai.candidate.autofill_extract',
        ]) {
            const flag = flags.get(name as never);
            expect(flag, `${name} missing from FLAG_REGISTRY`).toBeDefined();
            expect(flag?.default, `${name} should default true — the route is live`).toBe(true);
        }
    });

    it('jd_generator default is true so the registry reflects the live route', () => {
        expect(flagByName().get('ai.employer.jd_generator' as never)?.default).toBe(true);
    });

    it('cover_letter default stays false — the route 502d on every request pre-fix, so the repaired paid-only feature launches via a deliberate flag flip', () => {
        expect(flagByName().get('ai.candidate.cover_letter' as never)?.default).toBe(false);
    });
});

describe('F31 — autofill routes are gated', () => {
    const gates: Array<{ rel: string; flag: string }> = [
        { rel: 'app/api/autofill/classify-fields/route.ts', flag: 'ai.candidate.autofill_classify' },
        { rel: 'app/api/autofill/generate-cover-letter/route.ts', flag: 'ai.candidate.cover_letter' },
        { rel: 'app/api/autofill/generate-answer/route.ts', flag: 'ai.candidate.autofill_answer' },
        { rel: 'app/api/autofill/generate-bulk/route.ts', flag: 'ai.candidate.autofill_bulk' },
        { rel: 'app/api/autofill/extract-resume-sections/route.ts', flag: 'ai.candidate.autofill_extract' },
    ];

    for (const { rel, flag } of gates) {
        it(`${path.basename(path.dirname(rel))} checks '${flag}' before the model call`, () => {
            const src = read(rel);
            const gateIdx = src.indexOf(`checkAutofillAiFeature('${flag}'`);
            const completeIdx = src.indexOf('await complete({');
            expect(gateIdx, `flag gate for ${flag} missing`).toBeGreaterThan(-1);
            expect(gateIdx, 'flag gate must run before the model call').toBeLessThan(completeIdx);
        });
    }
});

describe('F31 — JD generator, thin-JD enrichment, and recommendations cron are gated', () => {
    it('ai-jd checks ai.employer.jd_generator before generating', () => {
        const src = read('app/api/employer/ai-jd/route.ts');
        const gateIdx = src.indexOf("isAiFeatureEnabled('ai.employer.jd_generator'");
        const completeIdx = src.indexOf('await complete<string>({');
        expect(gateIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(completeIdx);
    });

    it('enrich-thin-jds checks ai.platform.seo_content before selecting jobs', () => {
        const src = read('app/api/cron/enrich-thin-jds/route.ts');
        const gateIdx = src.indexOf("isAiFeatureEnabled('ai.platform.seo_content'");
        const workIdx = src.indexOf("withCronTracking('enrich-thin-jds'");
        expect(gateIdx).toBeGreaterThan(-1);
        expect(gateIdx, 'gate must precede the cron body').toBeLessThan(workIdx);
    });

    it('recommendations cron gates the COMPUTE, not just delivery', () => {
        const src = read('lib/inngest/functions/recommendations.ts');
        const gateIdx = src.indexOf("isAiFeatureEnabled('ai.candidate.recommendations'");
        const computeIdx = src.indexOf("step.run('list-candidate-embeddings'");
        expect(gateIdx).toBeGreaterThan(-1);
        expect(computeIdx).toBeGreaterThan(-1);
        expect(gateIdx, 'flag check must run before the candidate batch is even listed').toBeLessThan(computeIdx);
    });
});

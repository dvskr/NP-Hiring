/**
 * Smoke guard for the audit F28/F29/F30/F31 autofill package — every touched
 * module must import cleanly and expose its route handler. The other
 * ai-autofill regression files assert on SOURCE TEXT; this one catches what
 * they can't: syntax errors, broken import paths (e.g. the new ../_lib
 * helpers), and module-level throw on load.
 */
import { describe, it, expect } from 'vitest';

describe('autofill AI modules import cleanly', () => {
    it('classify-fields route exposes POST', async () => {
        const mod = await import('@/app/api/autofill/classify-fields/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('generate-cover-letter route exposes POST', async () => {
        const mod = await import('@/app/api/autofill/generate-cover-letter/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('generate-answer route exposes POST', async () => {
        const mod = await import('@/app/api/autofill/generate-answer/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('generate-bulk route exposes POST', async () => {
        const mod = await import('@/app/api/autofill/generate-bulk/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('extract-resume-sections route exposes POST', async () => {
        const mod = await import('@/app/api/autofill/extract-resume-sections/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('usage route exposes GET', async () => {
        const mod = await import('@/app/api/autofill/usage/route');
        expect(typeof mod.GET).toBe('function');
    });

    it('ai-jd route exposes POST', async () => {
        const mod = await import('@/app/api/employer/ai-jd/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('enrich-thin-jds route exposes GET', async () => {
        const mod = await import('@/app/api/cron/enrich-thin-jds/route');
        expect(typeof mod.GET).toBe('function');
    });

    it('shared quota + guard helpers export their API', async () => {
        const quota = await import('@/app/api/autofill/_lib/quota');
        expect(typeof quota.checkAutofillAiQuota).toBe('function');
        expect(typeof quota.getMonthlyAiGenerations).toBe('function');
        const guard = await import('@/app/api/autofill/_lib/guard');
        expect(typeof guard.checkAutofillAiFeature).toBe('function');
        expect(typeof guard.aiGatewayErrorResponse).toBe('function');
    });

    it('recommendations cron module loads with the flag gate in place', async () => {
        const mod = await import('@/lib/inngest/functions/recommendations');
        expect(mod.recommendationFunctions.length).toBeGreaterThan(0);
    });
});

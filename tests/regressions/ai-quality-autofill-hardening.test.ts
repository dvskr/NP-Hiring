/**
 * Regression guards — ai-quality wave 3.
 *
 * B89: inline resume extraction in generate-answer / classify-fields called
 *      pdf-parse's removed v1 function API, threw on every call, and the
 *      catch silently returned '' — resume context was ALWAYS empty. Both
 *      routes must now use the shared _lib/resume-text helper, which
 *      delegates to lib/resume-parser's pdf-parse v2 PDFParse-class path.
 *
 * B96: generate-answer request fields were unvalidated — non-string
 *      questionText 500'd on .toLowerCase, and maxLength was attacker-
 *      steerable without bounds. The route now zod-validates and clamps.
 *
 * B94: telemetry valueSample persisted raw filled values (emails, phones,
 *      potentially NPI/DEA). The ingest route must redact, and a retention
 *      cron must exist and be registered.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateAnswerRequestSchema } from '@/app/api/autofill/generate-answer/route';
import { redactValueSample } from '@/app/api/autofill/telemetry/route';
import {
    autofillTelemetryRetentionFunctions,
    TELEMETRY_RETENTION_DAYS,
} from '@/lib/inngest/functions/autofill-telemetry-retention';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B89 — autofill resume extraction uses the pdf-parse v2 API', () => {
    const routes = [
        'app/api/autofill/generate-answer/route.ts',
        'app/api/autofill/classify-fields/route.ts',
    ];

    for (const rel of routes) {
        it(`${path.basename(path.dirname(rel))} imports the shared v2-safe helper and has no inline pdf-parse`, () => {
            const src = read(rel);
            expect(src).toContain("from '../_lib/resume-text'");
            expect(src).toContain('fetchResumeTextFromSignedUrl');
            // The broken v1 patterns must not come back.
            expect(src).not.toContain("require('pdf-parse')");
            expect(src).not.toMatch(/pdfParseModule\.default \|\| pdfParseModule/);
        });
    }

    it('the shared helper delegates to lib/resume-parser (v2 PDFParse class path)', () => {
        const src = read('app/api/autofill/_lib/resume-text.ts');
        expect(src).toMatch(/import \{ extractResumeText \} from '@\/lib\/resume-parser'/);
        expect(src).not.toContain("require('pdf-parse')");
    });

    it('lib/resume-parser really is on the v2 class API (belt-and-suspenders)', () => {
        const src = read('lib/resume-parser.ts');
        expect(src).toContain('new PDFParse(');
    });
});

describe('B96 — generate-answer request validation', () => {
    it('rejects a missing/empty questionText', () => {
        expect(generateAnswerRequestSchema.safeParse({}).success).toBe(false);
        expect(generateAnswerRequestSchema.safeParse({ questionText: '' }).success).toBe(false);
        expect(generateAnswerRequestSchema.safeParse({ questionText: '   ' }).success).toBe(false);
    });

    it('rejects non-string questionText instead of throwing at .toLowerCase', () => {
        expect(generateAnswerRequestSchema.safeParse({ questionText: { evil: true } }).success).toBe(false);
        expect(generateAnswerRequestSchema.safeParse({ questionText: 42 }).success).toBe(false);
    });

    it('caps oversized questionText', () => {
        const parsed = generateAnswerRequestSchema.safeParse({ questionText: 'x'.repeat(50_000) });
        expect(parsed.success).toBe(false);
    });

    it('clamps maxLength abuse to the safe default instead of failing the fill', () => {
        const cases: Array<unknown> = [999_999_999, -50, 'DROP TABLE', { a: 1 }, Number.NaN];
        for (const maxLength of cases) {
            const parsed = generateAnswerRequestSchema.safeParse({ questionText: 'Why us?', maxLength });
            expect(parsed.success).toBe(true);
            if (parsed.success) expect(parsed.data.maxLength).toBe(300);
        }
    });

    it('accepts a normal request and applies defaults', () => {
        const parsed = generateAnswerRequestSchema.safeParse({ questionText: 'Why do you want this role?' });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.maxLength).toBe(300);
            expect(parsed.data.jobTitle).toBe('');
            expect(parsed.data.questionKey).toBe('');
        }
    });

    it('keeps an in-range maxLength as sent', () => {
        const parsed = generateAnswerRequestSchema.safeParse({ questionText: 'Q', maxLength: 800 });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.maxLength).toBe(800);
    });
});

describe('B94 — telemetry valueSample redaction', () => {
    it('drops samples for PII profileKeys', () => {
        for (const profileKey of ['email', 'phone', 'npiNumber', 'deaNumber', 'licenseNumber', 'addressLine1', 'firstName']) {
            expect(redactValueSample({ profileKey, valueSample: 'anything' })).toBeNull();
        }
    });

    it('drops samples for PII field types', () => {
        expect(redactValueSample({ fieldType: 'email', valueSample: 'x' })).toBeNull();
        expect(redactValueSample({ fieldType: 'tel', valueSample: 'x' })).toBeNull();
        expect(redactValueSample({ fieldType: 'password', valueSample: 'hunter2' })).toBeNull();
    });

    it('drops samples when the field name/label marks a PII field', () => {
        expect(redactValueSample({ fieldName: 'candidate_email', valueSample: 'x' })).toBeNull();
        expect(redactValueSample({ fieldLabel: 'DEA Number', valueSample: 'x' })).toBeNull();
        expect(redactValueSample({ fieldLabel: 'Home address line 1', valueSample: 'x' })).toBeNull();
        expect(redactValueSample({ fieldName: 'ssn', valueSample: 'x' })).toBeNull();
    });

    it('drops values that LOOK like PII even in unflagged fields', () => {
        expect(redactValueSample({ fieldName: 'misc', valueSample: 'jane@example.com' })).toBeNull();
        expect(redactValueSample({ fieldName: 'misc', valueSample: '(555) 010-0199' })).toBeNull();
        expect(redactValueSample({ fieldName: 'misc', valueSample: '1234567890' })).toBeNull();
    });

    it('truncates surviving samples to 40 chars', () => {
        const long = 'Outpatient clinic experience with adult populations and more text';
        const out = redactValueSample({ fieldName: 'setting_preference', valueSample: long });
        expect(out).toBe(long.substring(0, 40));
    });

    it('returns null for empty/absent samples', () => {
        expect(redactValueSample({ valueSample: null })).toBeNull();
        expect(redactValueSample({})).toBeNull();
    });

    it('ingest route persists via redactValueSample, not raw substring', () => {
        const src = read('app/api/autofill/telemetry/route.ts');
        expect(src).toContain('valueSample: redactValueSample(entry)');
        expect(src).not.toContain('entry.valueSample.substring(0, 100)');
    });

    it('retention cron exists (90 days) and is registered with the serve handler', () => {
        expect(TELEMETRY_RETENTION_DAYS).toBe(90);
        expect(autofillTelemetryRetentionFunctions).toHaveLength(1);
        const serveSrc = read('app/api/inngest/route.ts');
        expect(serveSrc).toContain('autofillTelemetryRetentionFunctions');
    });
});

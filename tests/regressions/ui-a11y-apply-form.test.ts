/**
 * Regression guard for B58 — Easy Apply form input a11y + validation.
 *
 * Previously:
 *   - Required screening questions had NO client-side validation: the form
 *     posted to the API and surfaced the server's 400 as a generic banner.
 *   - Screening inputs had no programmatic labels (question text was a bare
 *     <p>, inputs had no id/htmlFor/aria wiring).
 *   - The cover letter was silently truncated at 5,000 chars by the server
 *     with nothing in the UI stopping input at the cap.
 *
 * Follows the repo's static-source pin pattern (see
 * apply-modal-a11y-dialog.test.ts) so a future edit can't silently strip
 * the wiring out again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FORM = 'components/InPlatformApplyForm.tsx';
const API = 'app/api/applications/apply-direct/route.ts';

describe('B58 — screening questions have client-side required validation', () => {
    const src = read(FORM);

    it('validates required questions in handleSubmit before posting', () => {
        expect(src).toContain('const missing: Record<string, string>');
        expect(src).toMatch(/q\.isRequired && !\(screeningAnswers\[q\.id\] \|\| ''\)\.trim\(\)/);
        expect(src).toContain('setScreeningErrors(missing)');
        // Bails out (no fetch) and focuses the first invalid input.
        expect(src).toMatch(/document\.getElementById\(`screening-\$\{firstMissing\.id\}`\)\?\.focus\(\)/);
    });

    it('clears a question error as soon as the user answers it', () => {
        expect(src).toContain('const setAnswer = (questionId: string, value: string)');
        expect(src).toMatch(/delete next\[questionId\]/);
        // The raw setter must not be used directly by the question inputs anymore.
        expect(src).not.toMatch(/onChange=\{\(e\) => setScreeningAnswers\(/);
        expect(src).not.toMatch(/onClick=\{\(\) => setScreeningAnswers\(/);
    });

    it('renders an inline per-question error wired via aria-describedby', () => {
        expect(src).toContain('const errorId = `screening-${q.id}-error`');
        expect(src).toMatch(/id=\{errorId\} role="alert"/);
        expect(src).toContain("'aria-describedby': questionError ? errorId : undefined");
        expect(src).toContain("'aria-invalid': questionError ? true : undefined");
        expect(src).toContain("'aria-required': q.isRequired || undefined");
    });
});

describe('B58 — screening inputs have programmatic labels', () => {
    const src = read(FORM);

    it('associates text/number/select inputs with the question via htmlFor/id', () => {
        expect(src).toContain('const inputId = `screening-${q.id}`');
        expect(src).toContain('<label htmlFor={inputId}');
        expect(src).toContain('id={inputId}');
    });

    it('exposes boolean Yes/No as a labelled group with pressed state', () => {
        expect(src).toMatch(/role="group" aria-labelledby=\{`\$\{inputId\}-label`\}/);
        expect(src).toMatch(/aria-pressed=\{screeningAnswers\[q\.id\] === opt\.toLowerCase\(\)\}/);
    });

    it('labels the cover letter textarea via htmlFor', () => {
        expect(src).toContain('<label htmlFor="coverLetter"');
        expect(src).toContain('id="coverLetter"');
    });
});

describe('B58 — cover letter cap is enforced and surfaced, not silent', () => {
    const src = read(FORM);

    it('stops input at the cap with maxLength and a described-by counter', () => {
        expect(src).toContain('const COVER_LETTER_MAX = 5000');
        expect(src).toContain('maxLength={COVER_LETTER_MAX}');
        expect(src).toContain('aria-describedby="cover-letter-counter"');
        expect(src).toContain('id="cover-letter-counter"');
    });

    it('client cap matches the server truncation limit', () => {
        const api = read(API);
        const serverMax = api.match(/MAX_COVER_LETTER_LENGTH = (\d+)/)?.[1];
        const clientMax = src.match(/COVER_LETTER_MAX = (\d+)/)?.[1];
        expect(serverMax).toBeDefined();
        expect(clientMax).toBe(serverMax);
    });
});
